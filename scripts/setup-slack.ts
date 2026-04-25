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
import { readFileSync, writeFileSync, existsSync, appendFileSync, mkdirSync } from "fs";
import { homedir, userInfo } from "os";
import { dirname, join } from "path";
import { spawnSync } from "child_process";
import { loadConfig, findSource, getSlackToken } from "../src/config.js";

const ZSHRC = join(homedir(), ".zshrc");
const CONSOLE_YAML = join(homedir(), ".synthesis", "console.yaml");
const KEYCHAIN_MANIFEST = join(homedir(), ".synthesis", "keychain-tokens.txt");
const LAUNCH_AGENT_PLIST = join(
  homedir(),
  "Library",
  "LaunchAgents",
  "org.synthesisengineering.console.plist"
);

/**
 * Keychain service name for a given source. Convention:
 *   synthesis-console-slack-<source-name>
 * The wrapper script (scripts/launch.sh) reads this naming pattern from
 * the manifest at KEYCHAIN_MANIFEST.
 */
function keychainService(sourceName: string): string {
  return `synthesis-console-slack-${sourceName}`;
}

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

/**
 * Store the token in the macOS Keychain under a stable service name. Uses -U
 * to update an existing item rather than fail. The token never lands on disk
 * outside the Keychain's encrypted store — Spotlight, Time Machine, and
 * accidentally-shared screenshots can't expose it.
 */
function storeTokenInKeychain(sourceName: string, token: string): "added" | "updated" {
  const service = keychainService(sourceName);
  const account = userInfo().username;

  // Check if the item already exists.
  const existed =
    spawnSync("security", ["find-generic-password", "-a", account, "-s", service], {
      encoding: "utf-8",
    }).status === 0;

  const res = spawnSync(
    "security",
    [
      "add-generic-password",
      "-a", account,
      "-s", service,
      "-w", token,
      "-U", // update if exists
      "-T", "/usr/bin/security", // allow security CLI to read without prompting
      "-T", "", // also allow Apple-signed system processes (launchd) to read
      "-j", "Slack user OAuth token for synthesis-console (auto-managed by setup-slack)",
    ],
    { encoding: "utf-8" }
  );
  if (res.status !== 0) {
    throw new Error(`security add-generic-password failed: ${res.stderr}`);
  }
  return existed ? "updated" : "added";
}

/**
 * Maintain ~/.synthesis/keychain-tokens.txt — the manifest the LaunchAgent's
 * wrapper script reads. Format: <service-name>:<env-var-name> per line.
 * Idempotent: replaces a stale entry for the same service or appends a new one.
 */
function ensureKeychainManifestEntry(sourceName: string, envName: string): "added" | "updated" | "already-present" {
  const dir = dirname(KEYCHAIN_MANIFEST);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const service = keychainService(sourceName);
  const newLine = `${service}:${envName}`;

  let existing = "";
  if (existsSync(KEYCHAIN_MANIFEST)) existing = readFileSync(KEYCHAIN_MANIFEST, "utf-8");

  const lines = existing.split("\n");
  let found = false;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("#") || trimmed.length === 0) continue;
    if (trimmed.startsWith(`${service}:`)) {
      if (trimmed !== newLine) {
        lines[i] = newLine;
        changed = true;
      }
      found = true;
      break;
    }
  }
  if (!found) {
    if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    if (lines.length === 0) {
      lines.push(
        "# synthesis-console keychain-tokens manifest",
        "# Format: <keychain-service-name>:<env-var-name>",
        "# Read by scripts/launch.sh on autostart launch."
      );
    }
    lines.push(newLine);
    changed = true;
  }
  if (!changed && existing.length > 0) return "already-present";
  writeFileSync(KEYCHAIN_MANIFEST, lines.join("\n") + "\n", "utf-8");
  return found ? "updated" : "added";
}

/**
 * Ensure ~/.zshrc has an export line that fetches the token from the Keychain
 * via the security CLI at shell init. The literal token is NEVER written to
 * zshrc — only the security command that reads it. So zshrc remains safe to
 * back up, index, and share (the secret stays encrypted in the Keychain).
 */
function ensureZshrcExport(sourceName: string, envName: string): "added" | "updated" | "already-present" {
  const service = keychainService(sourceName);
  const exportLine =
    `export ${envName}="$(security find-generic-password -a "$USER" -s "${service}" -w 2>/dev/null)"`;
  let existing = "";
  if (existsSync(ZSHRC)) existing = readFileSync(ZSHRC, "utf-8");

  const exportRe = new RegExp(`^export\\s+${envName}=.*$`, "m");
  if (exportRe.test(existing)) {
    if (existing.match(exportRe)![0] === exportLine) return "already-present";
    const updated = existing.replace(exportRe, exportLine);
    writeFileSync(ZSHRC, updated, "utf-8");
    return "updated";
  }
  const block =
    (existing.endsWith("\n") || existing.length === 0 ? "" : "\n") +
    `\n# Slack user token for synthesis-console (auto-managed by setup-slack; reads from Keychain)\n${exportLine}\n`;
  appendFileSync(ZSHRC, block, "utf-8");
  return "added";
}

/**
 * Ensure the LaunchAgent plist invokes scripts/launch.sh (the Keychain-aware
 * wrapper) instead of bun directly, and that any stale token from earlier
 * versions has been removed from EnvironmentVariables.
 */
function ensurePlistWrapper(consoleRepoPath: string, envNamesToClear: string[]): "no-plist" | "ok" {
  if (!existsSync(LAUNCH_AGENT_PLIST)) return "no-plist";

  const wrapperPath = join(consoleRepoPath, "scripts", "launch.sh");

  // Replace ProgramArguments to point at the wrapper script.
  // Use Delete + Add for idempotence.
  spawnSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Delete :ProgramArguments", LAUNCH_AGENT_PLIST],
    { encoding: "utf-8" }
  );
  const addArgs = spawnSync(
    "/usr/libexec/PlistBuddy",
    [
      "-c", "Add :ProgramArguments array",
      "-c", `Add :ProgramArguments:0 string ${wrapperPath}`,
      LAUNCH_AGENT_PLIST,
    ],
    { encoding: "utf-8" }
  );
  if (addArgs.status !== 0) {
    throw new Error(`PlistBuddy failed (ProgramArguments): ${addArgs.stderr}`);
  }

  // Strip any pre-Keychain SLACK_USER_TOKEN_* entries from EnvironmentVariables.
  for (const name of envNamesToClear) {
    spawnSync(
      "/usr/libexec/PlistBuddy",
      ["-c", `Delete :EnvironmentVariables:${name}`, LAUNCH_AGENT_PLIST],
      { encoding: "utf-8" }
    );
  }
  return "ok";
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

  console.log(`Storing token in macOS Keychain...`);
  try {
    const r = storeTokenInKeychain(sourceName, token);
    console.log(`  ${keychainService(sourceName)}: ${r}.`);
    const m = ensureKeychainManifestEntry(sourceName, envName);
    console.log(`  Manifest ${KEYCHAIN_MANIFEST}: ${m}.`);
  } catch (err) {
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }

  if (!skipZshrc) {
    console.log(`Updating ${ZSHRC}...`);
    const r = ensureZshrcExport(sourceName, envName);
    console.log(`  ${envName} export (Keychain-fetched): ${r}.`);
  } else {
    console.log(`Skipping ~/.zshrc update (--no-zshrc).`);
  }

  if (!skipPlist) {
    console.log(`Updating LaunchAgent plist...`);
    try {
      // Determine consoleRepoPath — the directory containing scripts/launch.sh.
      // setup-slack.ts lives at <repo>/scripts/setup-slack.ts.
      const consoleRepoPath = join(new URL("..", import.meta.url).pathname);
      const r = ensurePlistWrapper(consoleRepoPath, [envName]);
      if (r === "no-plist") {
        console.log(`  No autostart plist found at ${LAUNCH_AGENT_PLIST}; skipping.`);
      } else {
        console.log(`  Plist ProgramArguments now invokes ${join(consoleRepoPath, "scripts", "launch.sh")}; stale ${envName} entry removed if present.`);
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
