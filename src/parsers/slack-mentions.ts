/**
 * Slack mention transforms: bidirectional translation between human-friendly
 * draft text (`@Saner`, `#mmc-product-growth-squad`) and Slack canonical
 * mention syntax (`<@U0AG66Z95KM>`, `<#C012345|mmc-product-growth-squad>`).
 *
 * The Slack rendering layer recognizes the canonical syntax regardless of
 * how the message arrived (paste-and-send via desktop, or chat.postMessage
 * via API), so substituting display names to canonical syntax on copy makes
 * mentions resolve in the recipient's view.
 *
 * Two operations:
 *   1. resolveMentions(text, dir) — substitute display forms to canonical
 *      syntax. For Smart Copy and pre-flight before chat.postMessage.
 *   2. renderMentionPills(html, dir) — replace canonical syntax in rendered
 *      HTML with visible pill markup so the reader sees what'll be a mention.
 */
import { escapeAttr, escapeHtml } from "../utils.js";
import type { SlackDirectory } from "./slack-directory.js";
import { normalizeName } from "./slack-directory.js";

/**
 * Convert display-form mentions in text to Slack canonical syntax.
 *
 * Recognized inputs:
 *   - `@<name-with-spaces>` (greedy, longest match wins) → `<@U...>` if known
 *   - `@<UserID>` (literal user ID with @ prefix) → `<@U...>`
 *   - `<@U...>` (already canonical) → preserved
 *   - `#<channel-name>` → `<#C...|name>` if known
 *   - `<#C...>` or `<#C...|name>` (already canonical) → preserved
 *
 * Names not in the directory are left untouched so the user can spot
 * unmapped mentions and decide whether to add them to the directory or
 * leave as plain text.
 */
export function resolveMentions(text: string, dir: SlackDirectory): string {
  let result = text;

  // Channels: # followed by a name, NOT preceded by `<` (which would mean
  // the syntax is already canonical `<#C...|name>`).
  result = result.replace(
    /(?<!<)#([a-zA-Z][\w-]{1,79})\b/g,
    (match, name: string) => {
      const ch = dir.channelByName.get(name.toLowerCase());
      if (!ch) return match;
      return `<#${ch.id}|${name}>`;
    }
  );

  // Users — @<UserID>; not preceded by `<` (already canonical `<@U...>`).
  result = result.replace(/(?<!<)@(U[A-Z0-9]{6,})\b/g, (_match, id: string) => {
    return `<@${id}>`;
  });

  if (dir.userByLookupKey.size > 0) {
    // Build a regex of all known names + aliases, sorted longest-first so
    // "Saner Keles" wins over "Saner". Word-boundary anchored so we don't
    // partial-match inside other tokens. Negative lookbehind skips already-
    // canonical `<@...` syntax (in case a display name shape ever collides).
    const keys = Array.from(dir.userByLookupKey.keys())
      .filter((k) => k.length > 0)
      .sort((a, b) => b.length - a.length);

    if (keys.length > 0) {
      const escaped = keys.map(escapeRegex).join("|");
      const re = new RegExp(`(?<!<)@(${escaped})\\b`, "gi");
      result = result.replace(re, (match, raw: string) => {
        const u = dir.userByLookupKey.get(normalizeName(raw));
        if (!u) return match;
        return `<@${u.id}>`;
      });
    }
  }

  return result;
}

/**
 * Render canonical mention syntax in rendered HTML as visible pills, so the
 * reader can see at a glance which words will trigger a Slack notification.
 *
 * Operates on rendered HTML (post-markdown). Skips matches inside attribute
 * values and tag bodies.
 */
export function renderMentionPills(html: string, dir: SlackDirectory): string {
  let result = html;

  // <@U...> → user pill
  result = result.replace(
    /(?<![<\w/&])&lt;@(U[A-Z0-9]{6,})&gt;|<@(U[A-Z0-9]{6,})>/g,
    (_match, escapedId: string | undefined, rawId: string | undefined) => {
      const id = (escapedId || rawId)!;
      const user = dir.userById.get(id);
      const display = user ? user.name : id;
      return `<span class="slack-pill slack-pill-user" data-user-id="${escapeAttr(id)}" title="${escapeAttr(`Slack mention: ${display} (${id})`)}">@${escapeHtml(display)}</span>`;
    }
  );

  // <#C...|name> or <#C...> → channel pill
  result = result.replace(
    /(?<![<\w/&])&lt;#([CG][A-Z0-9]{6,})(?:\|([^&<>]+))?&gt;|<#([CG][A-Z0-9]{6,})(?:\|([^|<>]+))?>/g,
    (_match, eId: string | undefined, eName: string | undefined, rId: string | undefined, rName: string | undefined) => {
      const id = (eId || rId)!;
      let display = eName || rName;
      if (!display) {
        const ch = dir.channelById.get(id);
        display = ch ? ch.name : id;
      }
      return `<span class="slack-pill slack-pill-channel" data-channel-id="${escapeAttr(id)}" title="${escapeAttr(`Slack channel: #${display} (${id})`)}">#${escapeHtml(display)}</span>`;
    }
  );

  return result;
}

/**
 * Identify mentions that resolve cleanly in `text`. Returns the canonical-form
 * mentions found after resolution. Useful for pre-flight: compute the canonical
 * form, count the pills, show "this message will mention 3 people".
 */
export function listResolvedMentions(text: string, dir: SlackDirectory): {
  users: { id: string; display: string }[];
  channels: { id: string; display: string }[];
  unresolved: { kind: "user" | "channel"; raw: string }[];
} {
  const resolved = resolveMentions(text, dir);
  const users: { id: string; display: string }[] = [];
  const channels: { id: string; display: string }[] = [];
  const unresolved: { kind: "user" | "channel"; raw: string }[] = [];

  for (const m of resolved.matchAll(/<@(U[A-Z0-9]{6,})>/g)) {
    const id = m[1];
    const user = dir.userById.get(id);
    users.push({ id, display: user ? user.name : id });
  }
  for (const m of resolved.matchAll(/<#([CG][A-Z0-9]{6,})(?:\|([^|<>]+))?>/g)) {
    const id = m[1];
    const display = m[2] || dir.channelById.get(id)?.name || id;
    channels.push({ id, display });
  }
  // Unresolved mentions are bare @name or #channel that didn't get rewritten.
  for (const m of resolved.matchAll(/(^|\s)@([A-Za-z][\w.-]{1,79})\b/g)) {
    if (!/^U[A-Z0-9]{6,}$/i.test(m[2])) {
      unresolved.push({ kind: "user", raw: `@${m[2]}` });
    }
  }
  for (const m of resolved.matchAll(/(^|\s)#([a-zA-Z][\w-]{1,79})\b/g)) {
    unresolved.push({ kind: "channel", raw: `#${m[2]}` });
  }

  return { users, channels, unresolved };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
