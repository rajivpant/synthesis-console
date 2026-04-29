/**
 * Cockpit view for daily plan detail pages.
 *
 * Server-side rendered HTML for typed sections detected by plan-sections.ts.
 * The view function is pure: (sections, draftsHtml, fullHtml, metadata) → string.
 * Client-side JS in layout.ts handles option clicks, task checkbox clicks,
 * filter chips, and in-page find.
 *
 * Region order (Rajiv reads tasks first):
 *   1. Glance bar
 *   2. NEEDS YOU (decisions)
 *   3. TODAY (tasks)
 *   4. DRAFTS (existing draft action bar reused via draftsHtml passthrough)
 *   5. Lower-row collapsibles (briefing / standup / waiting / sent / pr-queue / sync / completed / other)
 *   6. Full markdown (escape hatch)
 */
import MarkdownIt from "markdown-it";
import type {
  PlanSection,
  Decision,
  TaskBucket,
  PlanTask,
  TaskSemantic,
  SectionKind,
} from "../parsers/plan-sections.js";
import { collectAllDecisions, collectAllTasks } from "../parsers/plan-sections.js";
import { escapeHtml, escapeAttr } from "../utils.js";

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

function fmtAge(mtimeMs: number): string {
  const now = Date.now();
  const diffMs = now - mtimeMs;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export interface PlanCockpitOpts {
  date: string;
  sourceName: string;
  sections: PlanSection[];
  /** HTML for the drafts H2 section (rendered by markdown.ts with action bars).  */
  draftsHtml: string;
  /** HTML for the entire file (escape-hatch fallback). */
  fullMarkdownHtml: string;
  /** Slack directory island JSON, if any (passed through verbatim). */
  directoryIslandHtml: string;
  prevDate?: string;
  nextDate?: string;
  fileMtimeMs: number;
  /** Whether decision/task write-back is enabled (false in demo). */
  editable: boolean;
}

export function planCockpitView(opts: PlanCockpitOpts): string {
  const dayOfWeek = getDayOfWeek(opts.date);
  const headerSection = opts.sections.find((s) => s.kind === "header");
  const headerHtml = headerSection ? md.render(headerSection.rawBody) : "";

  const decisions = collectAllDecisions(opts.sections);
  const tasks = collectAllTasks(opts.sections);
  const decisionsOpen = decisions.filter((d) => !d.decided).length;
  const tasksDone = tasks.filter((t) => t.done).length;
  const tasksTotal = tasks.length;
  const draftCount = countDrafts(opts.draftsHtml);
  const sentToday = countSentToday(opts.draftsHtml);

  const needsYouHtml = renderNeedsYou(decisions, opts);
  const todayHtml = renderToday(opts.sections, opts);
  const draftsRegionHtml = renderDraftsRegion(opts.draftsHtml);
  const lowerRowHtml = renderLowerRow(opts.sections, opts.fullMarkdownHtml);

  const prevLink = opts.prevDate
    ? `<a href="/plans/${encodeURIComponent(opts.sourceName)}/${opts.prevDate}" rel="prev">&larr; ${escapeHtml(opts.prevDate)}</a>`
    : `<span class="muted">&larr;</span>`;
  const nextLink = opts.nextDate
    ? `<a href="/plans/${encodeURIComponent(opts.sourceName)}/${opts.nextDate}" rel="next">${escapeHtml(opts.nextDate)} &rarr;</a>`
    : `<span class="muted">&rarr;</span>`;

  return `
    <div class="cockpit-view" data-source="${escapeAttr(opts.sourceName)}" data-date="${escapeAttr(opts.date)}" data-editable="${opts.editable ? "true" : "false"}">
      <nav aria-label="breadcrumb" class="cockpit-breadcrumb">
        <ul>
          <li><a href="/plans">Daily Plans</a></li>
          <li><span class="source-badge">${escapeHtml(opts.sourceName)}</span></li>
          <li>${escapeHtml(dayOfWeek)}, ${escapeHtml(opts.date)}</li>
        </ul>
      </nav>

      <div class="cockpit-glance" role="region" aria-label="Day at a glance">
        <div class="cockpit-glance-title">
          <strong>${escapeHtml(dayOfWeek)}, ${escapeHtml(opts.date)}</strong>
          <span class="cockpit-glance-age" title="File last modified">Updated ${escapeHtml(fmtAge(opts.fileMtimeMs))}</span>
        </div>
        <div class="cockpit-glance-counts">
          ${renderCount("Decisions", decisionsOpen, decisions.length, "critical")}
          ${renderCount("Tasks", tasksTotal - tasksDone, tasksTotal, tasksDone === tasksTotal && tasksTotal > 0 ? "done" : "action")}
          ${renderCount("Drafts", draftCount, draftCount, "action")}
          ${renderCount("Sent today", sentToday, sentToday, "done")}
        </div>
        <div class="cockpit-glance-tools">
          <div class="cockpit-filter-chips" role="group" aria-label="View filters">
            <button type="button" class="cockpit-filter-chip cockpit-filter-active" data-filter="all">All</button>
            <button type="button" class="cockpit-filter-chip" data-filter="focus">Focus</button>
            <button type="button" class="cockpit-filter-chip" data-filter="find">⌘F Find</button>
          </div>
          <div class="cockpit-nav">
            ${prevLink}
            ${nextLink}
          </div>
        </div>
        <div class="cockpit-find-bar" hidden>
          <input type="search" class="cockpit-find-input" placeholder="Find in this plan…" aria-label="Find in this plan">
          <span class="cockpit-find-status" role="status" aria-live="polite"></span>
          <button type="button" class="cockpit-find-close" aria-label="Close find">&times;</button>
        </div>
      </div>

      ${headerHtml ? `<div class="cockpit-header rendered-markdown">${headerHtml}</div>` : ""}

      ${needsYouHtml}
      ${todayHtml}
      ${draftsRegionHtml}
      ${lowerRowHtml}

      ${opts.directoryIslandHtml || ""}
    </div>
  `;
}

function renderCount(label: string, openCount: number, total: number, tone: string): string {
  const display = total === 0 ? "0" : openCount === total ? `${total}` : `${openCount} / ${total}`;
  return `
    <span class="cockpit-count cockpit-count-${tone}" data-tone="${tone}">
      <span class="cockpit-count-num">${escapeHtml(display)}</span>
      <span class="cockpit-count-label">${escapeHtml(label)}</span>
    </span>
  `;
}

/* -------------------------------------------------------------------------- */
/* NEEDS YOU — decisions                                                      */
/* -------------------------------------------------------------------------- */

function renderNeedsYou(decisions: Decision[], opts: PlanCockpitOpts): string {
  if (decisions.length === 0) {
    return `
      <section class="cockpit-region cockpit-region-needs cockpit-region-empty" data-region="needs-you" aria-label="Needs you">
        <h2 class="cockpit-region-title">NEEDS YOU</h2>
        <p class="cockpit-region-empty-msg">No open decisions.</p>
      </section>
    `;
  }

  const cards = decisions.map((d) => renderDecisionCard(d, opts)).join("\n");
  return `
    <section class="cockpit-region cockpit-region-needs" data-region="needs-you" aria-label="Needs you">
      <h2 class="cockpit-region-title">NEEDS YOU
        <span class="cockpit-region-count">${decisions.filter((d) => !d.decided).length} open</span>
      </h2>
      ${cards}
    </section>
  `;
}

function renderDecisionCard(d: Decision, opts: PlanCockpitOpts): string {
  const optionButtons = d.options
    .map((o) => {
      const isChosen = d.decided && d.decidedOption === o.letter;
      const isUnchosen = d.decided && d.decidedOption !== o.letter;
      const cls = isChosen
        ? "cockpit-decision-option cockpit-decision-chosen"
        : isUnchosen
          ? "cockpit-decision-option cockpit-decision-unchosen"
          : "cockpit-decision-option";
      const isRecommended = !d.decided && d.recommendationLetter === o.letter;
      const recBadge = isRecommended
        ? '<span class="cockpit-decision-rec-badge">Recommended</span>'
        : "";
      const disabled = d.decided || !opts.editable ? " disabled" : "";
      return `
        <button type="button" class="${cls}" data-decision-index="${d.index}" data-option="${escapeAttr(o.letter)}"${disabled}>
          <span class="cockpit-decision-letter">${escapeHtml(o.letter)}</span>
          <span class="cockpit-decision-body">${md.renderInline(o.body)}</span>
          ${recBadge}
        </button>
      `;
    })
    .join("\n");

  const decidedNote = d.decided
    ? `<p class="cockpit-decision-decided-note">Decided: <strong>Option ${escapeHtml(d.decidedOption || "")}</strong>${d.decidedAt ? ` — ${escapeHtml(d.decidedAt)}` : ""}</p>`
    : "";

  const recommendation =
    !d.decided && d.recommendationLetter
      ? `<p class="cockpit-decision-rec"><strong>Recommendation:</strong> Option ${escapeHtml(d.recommendationLetter)}${d.recommendationBody ? ` — ${md.renderInline(d.recommendationBody)}` : ""}</p>`
      : "";

  return `
    <article class="cockpit-card cockpit-decision" data-decision-index="${d.index}" data-decided="${d.decided ? "true" : "false"}">
      <h3 class="cockpit-decision-question">${escapeHtml(d.question)}</h3>
      ${decidedNote}
      <div class="cockpit-decision-options" role="group" aria-label="Decision options">
        ${optionButtons}
      </div>
      ${recommendation}
      <div class="cockpit-decision-status" role="status" aria-live="polite"></div>
    </article>
  `;
}

/* -------------------------------------------------------------------------- */
/* TODAY — task buckets                                                       */
/* -------------------------------------------------------------------------- */

function renderToday(sections: PlanSection[], opts: PlanCockpitOpts): string {
  const taskSections = sections.filter((s) => s.kind === "priority-tasks");
  const totalTasks = taskSections.reduce(
    (n, s) => n + (s.taskBuckets || []).reduce((m, b) => m + b.tasks.length, 0),
    0
  );

  if (totalTasks === 0) {
    return `
      <section class="cockpit-region cockpit-region-today cockpit-region-empty" data-region="today" aria-label="Today">
        <h2 class="cockpit-region-title">TODAY</h2>
        <p class="cockpit-region-empty-msg">No priority tasks listed.</p>
      </section>
    `;
  }

  // Render all priority-tasks H2 sections; if there are multiple (rare), each gets its own header.
  const sectionsHtml = taskSections
    .map((s, sIdx) => {
      const buckets = s.taskBuckets || [];
      const bucketsHtml = buckets
        .map((b, bIdx) => renderTaskBucket(b, sIdx === 0 && bIdx === 0, opts))
        .join("\n");
      const sectionTitle = taskSections.length > 1
        ? `<h3 class="cockpit-region-subheading">${escapeHtml(s.rawHeading)}</h3>`
        : "";
      return `${sectionTitle}${bucketsHtml}`;
    })
    .join("\n");

  const tasksDone = taskSections.reduce(
    (n, s) =>
      n + (s.taskBuckets || []).reduce((m, b) => m + b.tasks.filter((t) => t.done).length, 0),
    0
  );

  return `
    <section class="cockpit-region cockpit-region-today" data-region="today" aria-label="Today">
      <h2 class="cockpit-region-title">TODAY
        <span class="cockpit-region-count">${tasksDone} / ${totalTasks} done</span>
      </h2>
      ${sectionsHtml}
    </section>
  `;
}

function semanticToTone(s: TaskSemantic): string {
  if (s === "p0") return "critical";
  if (s === "p1") return "action";
  if (s === "p2") return "context";
  if (s === "watch") return "waiting";
  if (s === "stale") return "waiting";
  return "context";
}

function renderTaskBucket(b: TaskBucket, defaultOpen: boolean, opts: PlanCockpitOpts): string {
  const tone = semanticToTone(b.semantic);
  const doneCount = b.tasks.filter((t) => t.done).length;
  const totalCount = b.tasks.length;
  const label = b.label || "Tasks";
  const openAttr = defaultOpen ? " open" : "";
  const tasksHtml = b.tasks.map((t) => renderTask(t, opts)).join("\n");

  return `
    <details class="cockpit-bucket cockpit-bucket-${tone}" data-bucket-semantic="${b.semantic}" data-bucket-index="${b.index}"${openAttr}>
      <summary class="cockpit-bucket-summary">
        <span class="cockpit-bucket-label">${escapeHtml(label)}</span>
        <span class="cockpit-bucket-count">${doneCount} / ${totalCount}</span>
      </summary>
      <ol class="cockpit-task-list">
        ${tasksHtml}
      </ol>
    </details>
  `;
}

function renderTask(t: PlanTask, opts: PlanCockpitOpts): string {
  const checked = t.done ? " checked" : "";
  const disabled = !opts.editable || t.done ? "" : "";
  // Strip the leading list marker from the rendered HTML body for cleaner inline rendering.
  const inlineBody = stripListWrapper(t.rendered);
  const doneBadge = t.done && t.doneTimestamp
    ? `<span class="cockpit-task-done-badge">${escapeHtml(t.doneTimestamp)}</span>`
    : "";
  const editableAttr = opts.editable ? "" : " data-readonly=\"true\"";
  return `
    <li class="cockpit-task${t.done ? " cockpit-task-done" : ""}" data-task-index="${t.index}" data-original-text="${escapeAttr(t.rawText)}"${editableAttr}>
      <label class="cockpit-task-label">
        <input type="checkbox" class="cockpit-task-check"${checked}${opts.editable ? "" : " disabled"} aria-label="Mark task ${t.index + 1} ${t.done ? "not done" : "done"}">
        <span class="cockpit-task-body">${inlineBody}</span>
        ${doneBadge}
      </label>
      <span class="cockpit-task-status" role="status" aria-live="polite"></span>
    </li>
  `;
}

function stripListWrapper(html: string): string {
  // markdown-it wraps single-paragraph items in <p>...</p>; drop it.
  const trimmed = html.trim();
  const m = trimmed.match(/^<p>([\s\S]*?)<\/p>\s*$/);
  if (m) return m[1];
  // Numbered list might wrap the whole thing in <ol><li>...</li></ol>; unwrap.
  const ol = trimmed.match(/^<ol[^>]*>\s*<li[^>]*>([\s\S]*)<\/li>\s*<\/ol>\s*$/);
  if (ol) {
    const inner = ol[1].trim();
    const innerP = inner.match(/^<p>([\s\S]*?)<\/p>\s*$/);
    return innerP ? innerP[1] : inner;
  }
  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* DRAFTS — passthrough of existing markdown.ts output                         */
/* -------------------------------------------------------------------------- */

function renderDraftsRegion(draftsHtml: string): string {
  if (!draftsHtml || draftsHtml.trim() === "") {
    return `
      <section class="cockpit-region cockpit-region-drafts cockpit-region-empty" data-region="drafts" aria-label="Drafts">
        <h2 class="cockpit-region-title">DRAFTS</h2>
        <p class="cockpit-region-empty-msg">No drafts in this plan.</p>
      </section>
    `;
  }
  // The drafts H2 is included in draftsHtml; we wrap to apply our region styling.
  return `
    <section class="cockpit-region cockpit-region-drafts" data-region="drafts" aria-label="Drafts">
      <h2 class="cockpit-region-title">DRAFTS</h2>
      <div class="cockpit-drafts-body rendered-markdown">${draftsHtml}</div>
    </section>
  `;
}

/* -------------------------------------------------------------------------- */
/* Lower-row collapsibles                                                     */
/* -------------------------------------------------------------------------- */

interface LowerRowGroup {
  kind: SectionKind;
  label: string;
  tone: string;
  sections: PlanSection[];
}

const LOWER_ROW_ORDER: { kind: SectionKind; label: string; tone: string }[] = [
  { kind: "briefing", label: "Briefing", tone: "context" },
  { kind: "standup", label: "Standup", tone: "context" },
  { kind: "waiting", label: "Waiting on others", tone: "waiting" },
  { kind: "completed", label: "Completed today", tone: "done" },
  { kind: "sent-messages", label: "Sent messages", tone: "done" },
  { kind: "pr-queue", label: "PR queue", tone: "context" },
  { kind: "sync-state", label: "Sync state", tone: "context" },
  { kind: "other", label: "Other", tone: "context" },
];

function renderLowerRow(sections: PlanSection[], fullMarkdownHtml: string): string {
  const groups: LowerRowGroup[] = LOWER_ROW_ORDER.map((g) => ({
    ...g,
    sections: sections.filter((s) => s.kind === g.kind),
  })).filter((g) => g.sections.length > 0);

  if (groups.length === 0 && !fullMarkdownHtml) return "";

  const groupsHtml = groups
    .map((g) => {
      const bodies = g.sections
        .map(
          (s) => `
        <div class="cockpit-collapsible-section rendered-markdown">
          <h3 class="cockpit-collapsible-subheading">${escapeHtml(s.rawHeading)}</h3>
          ${md.render(s.rawBody)}
        </div>
      `
        )
        .join("\n");
      const itemCount = g.sections.length;
      const countSuffix = itemCount > 1 ? ` (${itemCount})` : "";
      return `
        <details class="cockpit-collapsible cockpit-collapsible-${g.tone}" data-collapsible="${g.kind}">
          <summary class="cockpit-collapsible-summary">
            <span class="cockpit-collapsible-label">${escapeHtml(g.label)}${countSuffix}</span>
          </summary>
          <div class="cockpit-collapsible-body">${bodies}</div>
        </details>
      `;
    })
    .join("\n");

  const fullCollapsible = fullMarkdownHtml
    ? `
      <details class="cockpit-collapsible cockpit-collapsible-fullmarkdown" data-collapsible="full-markdown">
        <summary class="cockpit-collapsible-summary">
          <span class="cockpit-collapsible-label">Full markdown</span>
        </summary>
        <div class="cockpit-collapsible-body rendered-markdown">${fullMarkdownHtml}</div>
      </details>
    `
    : "";

  return `
    <section class="cockpit-region cockpit-region-collapsibles" aria-label="Reference and context">
      ${groupsHtml}
      ${fullCollapsible}
    </section>
  `;
}

/* -------------------------------------------------------------------------- */
/* Counts derived from rendered drafts HTML                                   */
/* -------------------------------------------------------------------------- */

function countDrafts(draftsHtml: string): number {
  if (!draftsHtml) return 0;
  const matches = draftsHtml.match(/class="draft-actions"/g);
  return matches ? matches.length : 0;
}

function countSentToday(draftsHtml: string): number {
  if (!draftsHtml) return 0;
  const matches = draftsHtml.match(/class="draft-actions draft-actions-sent"/g);
  return matches ? matches.length : 0;
}
