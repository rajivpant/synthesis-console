/**
 * Right sidebar for the v0.9 cockpit.
 *
 * Two widgets stacked vertically:
 *   1. Today's Wins — derived from `completed` and `sent-messages` typed
 *      sections. Compact one-line items: small green dot + first line of
 *      text (truncated), optional time suffix.
 *   2. Waiting On — derived from `waiting` typed sections. Same compact row
 *      shape, heather dot.
 *
 * Wraps both widgets in `<details class="cockpit-aside-collapsible">` for
 * mobile collapse; CSS forces them open at desktop.
 *
 * The data already exists in `sections` (parsed by `findPlanSections`).
 * The right sidebar extracts the rendered first-line of each list item /
 * paragraph and surfaces it as a compact row. The full content also
 * remains available in the main column's MORE collapsibles for users who
 * want to see verbatim source.
 */
import type { PlanSection } from "../../parsers/plan-sections.js";
import { collectAllTasks } from "../../parsers/plan-sections.js";
import { renderSidebarItem, renderAsideEmpty } from "./cards.js";

export interface SidebarRightOpts {
  sections: PlanSection[];
}

export function renderSidebarRight(opts: SidebarRightOpts): string {
  const wins = collectWins(opts.sections);
  const waiting = collectWaiting(opts.sections);

  const winsHtml =
    wins.length === 0
      ? renderAsideEmpty("Nothing checked off yet today.")
      : `<ul class="cockpit-aside-list cockpit-aside-list-wins">${wins
          .map((w) =>
            renderSidebarItem({
              tone: "done",
              text: escapeInline(w.text),
              suffix: w.suffix,
              title: w.text,
            })
          )
          .join("\n")}</ul>`;

  const waitingHtml =
    waiting.length === 0
      ? renderAsideEmpty("Nothing waiting on others.")
      : `<ul class="cockpit-aside-list cockpit-aside-list-waiting">${waiting
          .map((w) =>
            renderSidebarItem({
              tone: "waiting",
              text: escapeInline(w.text),
              suffix: w.suffix,
              title: w.text,
            })
          )
          .join("\n")}</ul>`;

  return `
    <aside class="cockpit-shell-aside-right" aria-label="Today's wins and waiting on others">
      <details class="cockpit-aside-collapsible cockpit-aside-right-collapsible" open>
        <summary class="cockpit-aside-summary">Wins &amp; Waiting On</summary>
        <div class="cockpit-aside-content">

          <section class="cockpit-aside-section cockpit-aside-section-wins" aria-label="Today's wins">
            <h3 class="cockpit-aside-heading">Today's Wins</h3>
            ${winsHtml}
          </section>

          <section class="cockpit-aside-section cockpit-aside-section-waiting" aria-label="Waiting on others">
            <h3 class="cockpit-aside-heading">Waiting On</h3>
            ${waitingHtml}
          </section>

        </div>
      </details>
    </aside>
  `;
}

/* -------------------------------------------------------------------------- */
/* Section harvesting                                                          */
/* -------------------------------------------------------------------------- */

interface SidebarItem {
  text: string;
  suffix?: string;
}

function collectWins(sections: PlanSection[]): SidebarItem[] {
  const items: SidebarItem[] = [];

  // Source 1: done priority tasks. The user's wins are the tasks they
  // actually checked off today — pulling these into the sidebar gives
  // immediate "look what you got done" feedback even when the plan has
  // no explicit "## Completed today" section.
  const allTasks = collectAllTasks(sections);
  for (const t of allTasks) {
    if (!t.done) continue;
    const firstLine = (t.rawText.split("\n")[0] || "").trim();
    const text = stripMarkdown(firstLine.replace(/^\s*\d+\.\s+/, "").replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, ""));
    if (!text) continue;
    items.push({ text, suffix: t.doneTimestamp });
  }

  // Source 2: sent drafts. Scan the drafts H2 sections for headings whose
  // section body contains a `**Sent:**` paragraph or a SENT marker in the
  // H3 itself (legacy form). Each sent draft becomes a win row.
  for (const s of sections) {
    if (s.kind !== "drafts") continue;
    const sentDrafts = extractSentDraftsFromSection(s.rawBody);
    for (const d of sentDrafts) {
      items.push({ text: d.title, suffix: d.suffix });
    }
  }

  // Source 3: explicit "## Completed today" / "## Sent messages" sections.
  // These cover plans that name them out (some users do — both forms are
  // valid synthesis-daily-rituals output).
  for (const s of sections) {
    if (s.kind !== "completed" && s.kind !== "sent-messages") continue;
    const lines = s.rawBody.split("\n");
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      const bulletMatch = trimmed.match(/^(?:[-*+]\s+|\d+\.\s+)(?:\[[xX]\]\s*)?(.+)$/);
      if (bulletMatch) {
        const text = stripMarkdown(bulletMatch[1]);
        if (text) items.push({ text, suffix: extractTimestamp(text) || undefined });
      }
    }
  }

  // De-duplicate by text. The same draft sometimes appears in both the
  // drafts section AND a separate sent-messages section.
  const seen = new Set<string>();
  const unique: SidebarItem[] = [];
  for (const it of items) {
    const key = it.text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  return unique.slice(0, 12);
}

interface SentDraftSummary {
  title: string;
  suffix?: string;
}

/**
 * Scan a drafts H2 section's body for sent drafts. A sent draft is an H3
 * heading whose subsequent block contains either:
 *   - a `**Sent:**` paragraph, OR
 *   - the legacy H3-jammed form (~~strikethrough~~ AND/OR `SENT` in heading)
 * Returns one summary entry per sent draft with the H3 title and best-effort
 * timestamp suffix.
 */
function extractSentDraftsFromSection(rawBody: string): SentDraftSummary[] {
  const lines = rawBody.split("\n");
  const summaries: SentDraftSummary[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const h3Match = ln.match(/^###\s+(.+?)\s*$/);
    if (!h3Match) continue;
    const heading = h3Match[1];

    // Check for legacy H3-jammed form first.
    const headingHasSent = /\bSENT\b/.test(heading) || /~~[^\n]+~~/.test(heading);

    // Look for a `**Sent:**` paragraph in the next ~30 lines (or until next H3/H2).
    let hasSentParagraph = false;
    let sentTime: string | undefined;
    for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
      const nl = lines[j];
      if (/^#{1,3}\s/.test(nl)) break;
      const sentMatch = nl.match(/^\s*\*\*\s*Sent\s*:?\s*\*\*\s*(.+?)\s*$/i);
      if (sentMatch) {
        hasSentParagraph = true;
        const tail = sentMatch[1];
        const timeMatch = tail.match(/(\d{1,2}:\d{2}(?:\s+[A-Z]{2,5})?)|(?:\b[A-Z][a-z]{2}\s+\d{1,2}\b)/);
        if (timeMatch) sentTime = timeMatch[0];
        break;
      }
    }

    if (!headingHasSent && !hasSentParagraph) continue;

    // Strip strikethrough wrapping + SENT metadata from the H3 to get the title.
    let title = heading
      .replace(/~~([^~]+)~~/, "$1")                        // unwrap ~~...~~
      .replace(/✅\s*SENT\s+by[^—]*—?/i, "")               // legacy "✅ SENT by ... at ... in ..."
      .replace(/\bSENT\b.*$/i, "")                          // anything after SENT keyword
      .replace(/\s+/g, " ")
      .trim();
    title = stripMarkdown(title);
    if (!title) continue;

    // Pull best-effort timestamp from heading if no Sent paragraph time.
    if (!sentTime) {
      const timeFromHeading = heading.match(/(\d{1,2}:\d{2}(?:\s+[A-Z]{2,5})?)/);
      if (timeFromHeading) sentTime = timeFromHeading[1];
    }

    summaries.push({ title, suffix: sentTime });
  }
  return summaries;
}

function collectWaiting(sections: PlanSection[]): SidebarItem[] {
  const items: SidebarItem[] = [];
  for (const s of sections) {
    if (s.kind !== "waiting") continue;
    const lines = s.rawBody.split("\n");
    for (const ln of lines) {
      const trimmed = ln.trim();
      if (!trimmed) continue;
      const bulletMatch = trimmed.match(/^(?:[-*+]\s+|\d+\.\s+)(?:\[[xX]\]\s*)?(.+)$/);
      if (bulletMatch) {
        const text = stripMarkdown(bulletMatch[1]);
        if (text) items.push({ text });
      }
    }
  }
  return items.slice(0, 12);
}

/**
 * Strip markdown bold/italic/links/inline-code so the sidebar row reads as
 * plain text. Preserves the substantive content of the line.
 */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")            // **bold**
    .replace(/\*([^*]+)\*/g, "$1")                 // *italic*
    .replace(/_([^_]+)_/g, "$1")                   // _italic_
    .replace(/`([^`]+)`/g, "$1")                   // `code`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")        // [link](url)
    .replace(/~~([^~]+)~~/g, "$1")                 // ~~strike~~
    .replace(/^\s*✅\s*/, "")                       // leading ✅
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Pull a "HH:MM TZ" or "HH:MM" timestamp from the line if present (for
 * wins like "✅ DONE 11:14 EDT — title"). Used as the sidebar row's
 * trailing suffix.
 */
function extractTimestamp(text: string): string | null {
  const m = text.match(/\b(\d{1,2}:\d{2}(?:\s+[A-Z]{2,5})?)\b/);
  return m ? m[1] : null;
}

function escapeInline(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
