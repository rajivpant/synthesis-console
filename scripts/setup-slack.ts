#!/usr/bin/env bun
/**
 * setup-slack — one-shot Slack integration setup.
 *
 * Reads a user OAuth token (xoxp-...), validates it via auth.test, derives
 * workspace_url and team_id from the response, writes them into the source's
 * slack: block in ~/.synthesis/console.yaml, persists the token in ~/.zshrc
 * and the LaunchAgent plist, reloads the LaunchAgent so autostart picks up
 * the new env var, and finally runs sync-slack-directory to populate the
 * users/channels YAML files.
 *
 * Usage:
 *   bun run scripts/setup-slack.ts <source-name>
 *     (token read from the env var named in source.slack.user_token_env;
 *      set it before running, e.g.
 *      SLACK_USER_TOKEN_RAJIV='xoxp-...' bun run scripts/setup-slack.ts personal)
 *
 *   bun run scripts/setup-slack.ts <source-name> --no-zshrc --no-plist
 *     (skip persistence; only update console.yaml + run sync)
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { loadConfig, findSource, getSlackToken } from "../src/config.js";

const ZSHRC = join(homedir(), ".zshrc");
const CONSOLE_YAML = join(homedir(), ".synthesis", "console.yaml");
const LAUNCH_AGENT_PLIST = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "org.synthesisengineering.console.plist"
);

interface AuthTestResponse {
  ok: boolean;
  url?: string;        // e.g. "https://rajivpant.slack.com/"
  team?: string;       // e.g. "Rajiv Pant"
  user?: string;       // e.g. "rajiv"
  team_id?: string;    // e.g. "T01234567"
  user_id?: string;    // e.g. "U0AG66Z95KM"
  error?: string;
}

async function authTest(token: string): Promise<AuthTestResponse> {
  const res = await fetch("https://slack.com/api/auth.test", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  return (await res.json()) as AuthTestResponse;
}

function workspaceUrlFromAuthTest(at: AuthTestResponse): string | undefined {
  if (!at.url) return undefined;
  // url is "https://<workspace>.slack.com/"; we want "<workspace>.slack.com"
  const m = at.url.match(/^https?:\/\/([^/]+)/);
  return m ? m[1] : undefined;
}

/**
 * Update the slack: block of a named source in console.yaml. Uncomments
 * workspace_url and team_id (or appends them if missing) and writes the
 * supplied values. Other lines and comments are preserved exactly.
 */
function updateConsoleYaml(
  yamlPath: string,
  sourceName: string,
  values: { workspace_url: string; team_id: string }
): void {
  const raw = readFileSync(yamlPath, "utf-8");
  const lines = raw.split("\n");

  // Find the source block start: a line `- name: <sourceName>` at top-level indent (2 spaces).
  let sourceStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s{2}-\s+name:\s*\S+/.test(lines[i])) {
      const m = lines[i].match(/name:\s*(\S+)/);
      if (m && m[1] === sourceName) {
        sourceStart = i;
        break;
      }
    }
  }
  if (sourceStart < 0) {
    throw new Error(`Source "${sourceName}" not found in ${yamlPath}.`);
  }

  // Find the next source start (or end of file) — that's our block end.
  let sourceEnd = lines.length;
  for (let i = sourceStart + 1; i < lines.length; i++) {
    if (/^\s{2}-\s+name:\s*\S+/.test(lines[i])) {
      sourceEnd = i;
      break;
    }
    // Also stop at top-level keys like "port:" that are at indent 0.
    if (/^\S/.test(lines[i])) {
      sourceEnd = i;
      break;
    }
  }

  // Find the slack: block within the source.
  let slackKeyLine = -1;
  for (let i = sourceStart; i < sourceEnd; i++) {
    if (/^\s{4}slack:\s*$/.test(lines[i])) {
      slackKeyLine = i;
      break;
    }
  }
  if (slackKeyLine < 0) {
    // Insert a slack: block at the end of the source.
    lines.splice(
      sourceEnd,
      0,
      `    slack:`,
      `      workspace_url: ${values.workspace_url}`,
      `      team_id: ${values.team_id}`
    );
    writeFileSync(yamlPath, lines.join("\n"), "utf-8");
    return;
  }

  // Find the slack block extent.
  let slackEnd = sourceEnd;
  for (let i = slackKeyLine + 1; i < sourceEnd; i++) {
    // Slack block lines are indented at 6 (two extra past source indent of 4)
    // OR they're commented at indent 6. Anything at indent 4 or less is OUT.
    if (lines[i].length === 0) continue;
    if (/^\s{0,4}\S/.test(lines[i])) {
      slackEnd = i;
      break;
    }
  }

  // Update or insert workspace_url + team_id within the slack block.
  upsertKey(lines, slackKeyLine + 1, slackEnd, "workspace_url", values.workspace_url, 6);
  upsertKey(lines, slackKeyLine + 1, slackEnd, "team_id", values.team_id, 6);

  writeFileSync(yamlPath, lines.join("\n"), "utf-8");
}

function upsertKey(
  lines: string[],
  blockStart: number,
  blockEnd: number,
  key: string,
  value: string,
  indent: number
): void {
  const indentStr = " ".repeat(indent);
  const target = `${indentStr}${key}: ${value}`;

  for (let i = blockStart; i < blockEnd; i++) {
    const line = lines[i];
    // Match either uncommented or commented version of the key.
    const re = new RegExp(`^\\s*#?\\s*${key}\\s*:\\s*(.*)$`);
    const m = line.match(re);
    if (m && /^\s*[#\s]*\w/.test(line.split(":")[0])) {
      // Make sure it's our key, not a substring.
      if (line.replace(/^\s*#?\s*/, "").startsWith(`${key}:`)) {
        lines[i] = target;
        return;
      }
    }
  }
  // Not found — insert at the start of the block (right after the slack: line).
  lines.splice(blockStart, 0, target);
}

function ensureZshrcExport(envName: string, token: string): "added" | "already-present" {
  const exportLine = `export ${envName}='${token}'`;
  let existing = "";
  if (existsSync(ZSHRC)) existing = readFileSync(ZSHRC, "utf-8");

  // If a different export of the same var exists, replace it. Otherwise append.
  const exportRe = new RegExp(`^export\\s+${envName}=.*$`, "m");
  if (exportRe.test(existing)) {
    if (existing.match(exportRe)![0] === exportLine) return "already-present";
    const updated = existing.replace(exportRe, exportLine);
    writeFileSync(ZSHRC, updated, "utf-8");
    return "added";
  }
  const block =
    (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") +
    `\n# Slack user token for synthesis-console (auto-managed)\n${exportLine}\n`;
  appendFileSync(ZSHRC, block, "utf-8");
  return "added";
}

function ensurePlistEnvVar(envName: string, token: string): "added" | "updated" | "no-plist" {
  if (!existsSync(LAUNCH_AGENT_PLIST)) return "no-plist";

  // Use PlistBuddy via child_process to set the key.
  // First check if it exists:
  const printRes = spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", `Print :EnvironmentVariables:${envName}`, LAUNCH_AGENT_PLIST],
    { encoding: "utf-8" }
  );
  const exists = printRes.status === 0;

  const cmd = exists
    ? `Set :EnvironmentVariables:${envName} ${token}`
    : `Add :EnvironmentVariables:${envName} string ${token}`;
  const res = spawnSync("/usr/libexec/PlistBuddy", ["-c", cmd, LAUNCH_AGENT_PLIST], {
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`PlistBuddy failed: ${res.stderr}`);
  }
  return exists ? "updated" : "added";
}

function reloadLaunchAgent(): "ok" | "not-loaded" | "error" {
  const unload = spawnSync(
    "launchctl",
    ["unload", LAUNCH_AGENT_PLIST],
    { encoding: "utf-8" }
  );
  if (unload.status !== 0 && !/Could not find/.test(unload.stderr || "")) {
    // Not loaded is fine; other errors aren't.
  }
  const load = spawnSync("launchctl", ["load", LAUNCH_AGENT_PLIST], {
    encoding: "utf-8",
  });
  if (load.status !== 0) return "error";
  return "ok";
}

function runSyncSlack(sourceName: string, env: NodeJS.ProcessEnv): boolean {
  const here = new URL("./sync-slack-directory.ts", import.meta.url).pathname;
  const res = spawnSync("bun", ["run", here, sourceName], {
    stdio: "inherit",
    env,
  });
  return res.status === 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const sourceName = args[0];
  const flags = new Set(args.slice(1));
  const skipZshrc = flags.has("--no-zshrc");
  const skipPlist = flags.has("--no-plist");
  const skipSync = flags.has("--no-sync");

  if (!sourceName) {
    console.error("Usage: bun run scripts/setup-slack.ts <source-name> [--no-zshrc] [--no-plist] [--no-sync]");
    process.exit(1);
  }

  const config = loadConfig();
  const src = findSource(config.sources, sourceName);
  if (!src) {
    console.error(`Source "${sourceName}" not found in ${CONSOLE_YAML}.`);
    process.exit(1);
  }
  if (!src.slack || !src.slack.user_token_env) {
    console.error(
      `Source "${sourceName}" has no slack.user_token_env declared. Add it to ${CONSOLE_YAML} first.`
    );
    process.exit(1);
  }

  const envName = src.slack.user_token_env;
  const token = process.env[envName];
  if (!token) {
    console.error(
      `Env var ${envName} is unset. Run with the token in env, e.g.:\n` +
      `  ${envName}='xoxp-...' bun run scripts/setup-slack.ts ${sourceName}`
    );
    process.exit(1);
  }
  if (!token.startsWith("xoxp-")) {
    console.error(
      `Token doesn't start with "xoxp-". Direct send requires a USER OAuth token, not a bot token (xoxb-).`
    );
    process.exit(1);
  }

  console.log(`Validating token against Slack...`);
  const at = await authTest(token);
  if (!at.ok) {
    console.error(`auth.test failed: ${at.error}`);
    process.exit(1);
  }
  const workspaceUrl = workspaceUrlFromAuthTest(at);
  if (!workspaceUrl || !at.team_id) {
    console.error("auth.test response missing url or team_id; cannot proceed.");
    console.error(JSON.stringify(at, null, 2));
    process.exit(1);
  }
  console.log(`  Authenticated as ${at.user} on ${at.team} (${at.team_id})`);
  console.log(`  Workspace URL: ${workspaceUrl}`);

  console.log(`Updating ${CONSOLE_YAML}...`);
  updateConsoleYaml(CONSOLE_YAML, sourceName, {
    workspace_url: workspaceUrl,
    team_id: at.team_id,
  });
  console.log(`  Wrote workspace_url and team_id under sources[${sourceName}].slack.`);

  if (!skipZshrc) {
    console.log(`Updating ${ZSHRC}...`);
    const r = ensureZshrcExport(envName, token);
    console.log(`  ${envName}: ${r}.`);
  } else {
    console.log(`Skipping ~/.zshrc update (--no-zshrc).`);
  }

  if (!skipPlist) {
    console.log(`Updating LaunchAgent plist...`);
    try {
      const r = ensurePlistEnvVar(envName, token);
      if (r === "no-plist") {
        console.log(`  No autostart plist found at ${LAUNCH_AGENT_PLIST}; skipping.`);
      } else {
        console.log(`  ${envName} ${r} in plist EnvironmentVariables.`);
        console.log(`Reloading LaunchAgent...`);
        const reload = reloadLaunchAgent();
        console.log(`  ${reload}`);
      }
    } catch (err) {
      console.error(`  ${(err as Error).message}`);
    }
  } else {
    console.log(`Skipping plist update (--no-plist).`);
  }

  if (!skipSync) {
    console.log(`Running sync-slack-directory...`);
    const ok = runSyncSlack(sourceName, { ...process.env, [envName]: token });
    if (!ok) {
      console.error(`sync-slack-directory failed.`);
      process.exit(1);
    }
  } else {
    console.log(`Skipping sync (--no-sync).`);
  }

  console.log(`\nDone. Visit http://localhost:5555/plans to see Slack-aware drafts.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
