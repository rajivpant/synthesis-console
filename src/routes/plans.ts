import { Hono } from "hono";
import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import type { ConsoleConfig, Source } from "../config.js";
import { getPlansPath, findSource, getSlackToken } from "../config.js";
import { readAndRenderPlanMarkdown } from "../parsers/markdown.js";
import { replaceDraftBody, findDraftBlocks, markDraftAsSent } from "../parsers/draft-blocks.js";
import { loadSlackDirectory } from "../parsers/slack-directory.js";
import { resolveMentions, listResolvedMentions } from "../parsers/slack-mentions.js";
import { postSlackMessage } from "../integrations/slack-send.js";
import { layout } from "../views/layout.js";
import { planListView, planDetailView } from "../views/plan.js";
import type { PlanEntry } from "../views/plan.js";
import { escapeHtml, sanitizePathSegment } from "../utils.js";
import { activeSources } from "../active-sources.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parsePlanFilename(filename: string, sourceName: string): PlanEntry | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const date = match[1];
  const [y, m, d] = date.split("-").map(Number);
  const dayOfWeek = DAYS[new Date(y, m - 1, d).getDay()];
  return { date, filename, dayOfWeek, source: sourceName };
}

function loadPlansFromSource(src: Source): PlanEntry[] {
  const plansDir = getPlansPath(src);
  if (!plansDir || !existsSync(plansDir)) return [];

  const files = readdirSync(plansDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  const out: PlanEntry[] = [];
  for (const f of files) {
    const entry = parsePlanFilename(f, src.name);
    if (entry) out.push(entry);
  }
  return out;
}

export function planRoutes(config: ConsoleConfig) {
  const app = new Hono();

  app.get("/plans", (c) => {
    const active = activeSources(c, config);
    const plans: PlanEntry[] = [];
    for (const src of active) {
      plans.push(...loadPlansFromSource(src));
    }
    plans.sort((a, b) => b.date.localeCompare(a.date));

    const content = planListView({ plans, sources: active });

    return c.html(
      layout({
        title: "Daily Plans",
        content,
        sources: config.sources,
        activeSourceNames: active.map((s) => s.name),
        currentPath: "/plans",
        demoMode: config.demoMode,
      })
    );
  });

  app.get("/plans/:source/:date", (c) => {
    const active = activeSources(c, config);
    const sourceName = sanitizePathSegment(c.req.param("source"));
    const date = sanitizePathSegment(c.req.param("date"));

    if (!sourceName || !date) {
      return notFound(c, config, active, "Not found.");
    }

    const src = findSource(config.sources, sourceName);
    if (!src) return notFound(c, config, active, `Source "${escapeHtml(sourceName)}" not found.`);

    const plansDir = getPlansPath(src);
    if (!plansDir) {
      return notFound(c, config, active, `Source "${escapeHtml(sourceName)}" does not provide daily plans.`);
    }

    const filePath = join(plansDir, `${date}.md`);
    const directory = loadSlackDirectory(src);
    const slackEnabled = !src.demo && !!getSlackToken(src);
    const contentHtml = readAndRenderPlanMarkdown(filePath, {
      editable: !src.demo,
      slackEnabled,
      directory,
      slack: src.slack
        ? { workspace_url: src.slack.workspace_url, team_id: src.slack.team_id }
        : undefined,
    });
    if (!contentHtml) {
      return notFound(c, config, active, `No plan for ${escapeHtml(date)} in ${escapeHtml(sourceName)}.`);
    }

    const allPlans = loadPlansFromSource(src);
    const sortedAsc = [...allPlans].sort((a, b) => a.date.localeCompare(b.date));
    const currentIdx = sortedAsc.findIndex((p) => p.date === date);
    const prevDate = currentIdx > 0 ? sortedAsc[currentIdx - 1].date : undefined;
    const nextDate = currentIdx < sortedAsc.length - 1 ? sortedAsc[currentIdx + 1].date : undefined;

    const content = planDetailView({
      date,
      contentHtml,
      sourceName: src.name,
      prevDate,
      nextDate,
    });

    return c.html(
      layout({
        title: `Plan — ${date}`,
        content,
        sources: config.sources,
        activeSourceNames: active.map((s) => s.name),
        currentPath: `/plans/${src.name}/${date}`,
        demoMode: config.demoMode,
      })
    );
  });

  // Save an edited draft body. Compare-and-swap on the original body text:
  // a 409 response means the file changed externally and the client should
  // reload to get a fresh baseline before retrying.
  app.put("/plans/:source/:date/draft/:index", async (c) => {
    const sourceName = sanitizePathSegment(c.req.param("source"));
    const date = sanitizePathSegment(c.req.param("date"));
    const indexStr = sanitizePathSegment(c.req.param("index"));

    if (!sourceName || !date || !indexStr) {
      return c.json({ ok: false, error: "Invalid request path." }, 400);
    }

    const draftIndex = Number(indexStr);
    if (!Number.isInteger(draftIndex) || draftIndex < 0 || draftIndex > 999) {
      return c.json({ ok: false, error: "Invalid draft index." }, 400);
    }

    const src = findSource(config.sources, sourceName);
    if (!src) return c.json({ ok: false, error: "Source not found." }, 404);
    if (src.demo) {
      return c.json({ ok: false, error: "Demo data is read-only." }, 403);
    }

    const plansDir = getPlansPath(src);
    if (!plansDir) {
      return c.json({ ok: false, error: "Source has no plans directory." }, 404);
    }

    const filePath = join(plansDir, `${date}.md`);
    if (!existsSync(filePath)) {
      return c.json({ ok: false, error: "Plan file not found." }, 404);
    }

    let body: { originalText?: unknown; newText?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: "Invalid JSON body." }, 400);
    }

    const originalText = typeof body.originalText === "string" ? body.originalText : "";
    const newText = typeof body.newText === "string" ? body.newText : "";
    if (!originalText && !body.originalText) {
      return c.json({ ok: false, error: "originalText is required." }, 400);
    }

    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch {
      return c.json({ ok: false, error: "Could not read plan file." }, 500);
    }

    const result = replaceDraftBody(raw, draftIndex, originalText, newText);
    if (!result.ok) {
      const status = result.reason === "conflict" ? 409 : result.reason === "empty" ? 400 : 404;
      const message =
        result.reason === "conflict"
          ? "The file changed since this draft was loaded. Reload the page and try again."
          : result.reason === "empty"
            ? "Draft body cannot be empty."
            : "Draft not found.";
      return c.json({ ok: false, error: message }, status);
    }

    // Atomic-ish replace: write to a sibling temp file, then rename over the original.
    // Same-filesystem rename is atomic on POSIX; same-volume on macOS for plain HFS+/APFS.
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tempPath, result.newRaw, "utf-8");
      renameSync(tempPath, filePath);
    } catch (err) {
      return c.json({ ok: false, error: "Could not write plan file." }, 500);
    }

    return c.json({ ok: true });
  });

  // Preflight a Slack send: returns the resolved-mention text and the list of
  // pending mentions so the confirmation modal can show "this will mention 3
  // people in #channel" before the user clicks Send.
  app.get("/plans/:source/:date/draft/:index/preflight", (c) => {
    const sourceName = sanitizePathSegment(c.req.param("source"));
    const date = sanitizePathSegment(c.req.param("date"));
    const indexStr = sanitizePathSegment(c.req.param("index"));
    if (!sourceName || !date || !indexStr) return c.json({ ok: false, error: "Invalid path." }, 400);
    const idx = Number(indexStr);
    if (!Number.isInteger(idx) || idx < 0 || idx > 999) {
      return c.json({ ok: false, error: "Invalid draft index." }, 400);
    }
    const src = findSource(config.sources, sourceName);
    if (!src) return c.json({ ok: false, error: "Source not found." }, 404);
    if (src.demo) return c.json({ ok: false, error: "Demo data is read-only." }, 403);

    const plansDir = getPlansPath(src);
    if (!plansDir) return c.json({ ok: false, error: "No plans dir." }, 404);
    const filePath = join(plansDir, `${date}.md`);
    if (!existsSync(filePath)) return c.json({ ok: false, error: "Plan file not found." }, 404);

    const raw = readFileSync(filePath, "utf-8");
    const drafts = findDraftBlocks(raw);
    const draft = drafts[idx];
    if (!draft) return c.json({ ok: false, error: "Draft not found." }, 404);
    if (draft.alreadySent) return c.json({ ok: false, error: "Draft already sent." }, 409);

    const directory = loadSlackDirectory(src);
    const resolvedText = resolveMentions(draft.bodyText, directory);
    const mentions = listResolvedMentions(draft.bodyText, directory);

    return c.json({
      ok: true,
      bodyOriginal: draft.bodyText,
      bodyResolved: resolvedText,
      mentions,
      sendToText: draft.sendToText || null,
      tokenConfigured: !!getSlackToken(src),
    });
  });

  // Direct Slack send via Web API. Uses the user OAuth token from the env var
  // declared in source.slack.user_token_env. On success: records a `**Sent:**`
  // marker after the draft body so the page reload shows the sent state.
  app.post("/plans/:source/:date/draft/:index/send", async (c) => {
    const sourceName = sanitizePathSegment(c.req.param("source"));
    const date = sanitizePathSegment(c.req.param("date"));
    const indexStr = sanitizePathSegment(c.req.param("index"));
    if (!sourceName || !date || !indexStr) return c.json({ ok: false, error: "Invalid path." }, 400);
    const idx = Number(indexStr);
    if (!Number.isInteger(idx) || idx < 0 || idx > 999) {
      return c.json({ ok: false, error: "Invalid draft index." }, 400);
    }

    const src = findSource(config.sources, sourceName);
    if (!src) return c.json({ ok: false, error: "Source not found." }, 404);
    if (src.demo) return c.json({ ok: false, error: "Demo data is read-only." }, 403);

    const token = getSlackToken(src);
    if (!token) {
      return c.json(
        {
          ok: false,
          error:
            "Slack send is not configured for this source. Set the env var named in source.slack.user_token_env to a user OAuth token (xoxp-...) and reload.",
        },
        403
      );
    }

    const plansDir = getPlansPath(src);
    if (!plansDir) return c.json({ ok: false, error: "No plans dir." }, 404);
    const filePath = join(plansDir, `${date}.md`);
    if (!existsSync(filePath)) return c.json({ ok: false, error: "Plan file not found." }, 404);

    let body: { confirmed?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ ok: false, error: "Invalid JSON body." }, 400);
    }
    if (body.confirmed !== true) {
      return c.json({ ok: false, error: "Send must be explicitly confirmed." }, 400);
    }

    const raw = readFileSync(filePath, "utf-8");
    const drafts = findDraftBlocks(raw);
    const draft = drafts[idx];
    if (!draft) return c.json({ ok: false, error: "Draft not found." }, 404);
    if (draft.alreadySent) return c.json({ ok: false, error: "Draft already sent." }, 409);

    const directory = loadSlackDirectory(src);
    const text = resolveMentions(draft.bodyText, directory);
    if (text.trim().length === 0) {
      return c.json({ ok: false, error: "Cannot send empty body." }, 400);
    }

    // Determine target from sendToText.
    const target = parseSendToFromRaw(draft.sendToText || "", directory);
    if (!target) {
      return c.json(
        {
          ok: false,
          error:
            "Could not determine Slack target from this draft's Send-to line. Add a channel ID, DM channel ID, or user ID to make it sendable.",
        },
        400
      );
    }

    const sendResult = await postSlackMessage(token, target, text);
    if (!sendResult.ok) {
      return c.json({ ok: false, error: `Slack: ${sendResult.error}` }, 502);
    }

    // Append `**Sent:**` marker to the file. On marker write failure, the
    // message HAS gone out — surface the partial-success state.
    const sentAtIso = new Date().toISOString();
    const markResult = markDraftAsSent(raw, idx, {
      ts: sendResult.ts!,
      permalink: sendResult.permalink,
      sentAtIso,
    });

    if (!markResult.ok) {
      return c.json(
        {
          ok: true,
          warning:
            "Message sent successfully, but the daily plan file could not be annotated. Add a **Sent:** marker manually if desired.",
          ts: sendResult.ts,
          permalink: sendResult.permalink,
        }
      );
    }

    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tempPath, markResult.newRaw, "utf-8");
      renameSync(tempPath, filePath);
    } catch {
      return c.json(
        {
          ok: true,
          warning:
            "Message sent successfully, but the daily plan file could not be written. Add a **Sent:** marker manually if desired.",
          ts: sendResult.ts,
          permalink: sendResult.permalink,
        }
      );
    }

    return c.json({
      ok: true,
      ts: sendResult.ts,
      channel: sendResult.channel,
      permalink: sendResult.permalink,
    });
  });

  return app;
}

import type { SlackDirectory } from "../parsers/slack-directory.js";
import type { SlackSendTarget } from "../integrations/slack-send.js";

/**
 * Parse a Send-to line directly from raw markdown (post-stripping the
 * `**Send to:**` prefix) into a Slack send target. Mirrors the rendering-side
 * parseSendTo but skips HTML decoding since the input is already plain text.
 */
function parseSendToFromRaw(raw: string, dir: SlackDirectory): SlackSendTarget | null {
  if (!raw) return null;
  const text = raw.replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  const threadMatch = text.match(/TS\s*[=:]\s*([\d.]+)/i);
  const dmMatch = text.match(/\b(D[A-Z0-9]{6,})\b/);
  const userMatch = text.match(/\b(U[A-Z0-9]{6,})\b/);
  const channelNameMatch = text.match(/#([a-zA-Z][\w-]+)/);
  const channelIdMatch = text.match(/\b(C[A-Z0-9]{6,})\b/);

  // Resolve channel name → ID via directory if a name is present.
  let channelId: string | undefined =
    channelIdMatch?.[1] ||
    (channelNameMatch ? dir.channelByName.get(channelNameMatch[1].toLowerCase())?.id : undefined);

  if (dmMatch) {
    return {
      channel: dmMatch[1],
      thread_ts: threadMatch?.[1],
    };
  }
  if (channelId) {
    return {
      channel: channelId,
      thread_ts: threadMatch?.[1],
    };
  }
  if (userMatch) {
    // Slack opens DM with this user when a U... is supplied as channel.
    return {
      channel: userMatch[1],
      thread_ts: threadMatch?.[1],
    };
  }
  return null;
}

function notFound(
  c: import("hono").Context,
  config: ConsoleConfig,
  active: Source[],
  message: string
) {
  return c.html(
    layout({
      title: "Not Found",
      content: `<h1>Not found</h1><p>${message}</p><p><a href="/plans">Back to plans</a></p>`,
      sources: config.sources,
      activeSourceNames: active.map((s) => s.name),
      currentPath: "/plans",
      demoMode: config.demoMode,
    }),
    404
  );
}
