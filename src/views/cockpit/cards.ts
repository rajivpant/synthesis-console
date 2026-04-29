/**
 * Card primitives for the v0.9 cockpit.
 *
 * Pure renderers (no side effects) for the typed UI elements the cockpit
 * composes: decision cards, task rows, draft cards, sidebar list items,
 * project list rows, progress bar.
 *
 * Extracted from `plan-cockpit.ts` in v0.9.0 so the new three-column shell
 * (`shell.ts`) and column views (`main-column.ts`, `sidebar-left.ts`,
 * `sidebar-right.ts`) can compose cards without duplicating their HTML
 * shape.
 *
 * Behavioral parity with v0.8.x: the existing `.cockpit-decision`,
 * `.cockpit-task`, `.cockpit-bucket`, `.draft-actions`, `.cockpit-region-*`
 * classes are preserved so all existing CSS and JS handlers (decision pick,
 * task checkbox, filter chips, find, mtime auto-refresh, etc.) keep working
 * unchanged. v0.9 adds compact variants (`.cockpit-task-compact`,
 * `.cockpit-decision-compact`) and new sidebar primitives — additive only.
 */
import MarkdownIt from "markdown-it";
import type {
  Decision,
  TaskBucket,
  PlanTask,
  TaskSemantic,
} from "../../parsers/plan-sections.js";
import { escapeHtml, escapeAttr } from "../../utils.js";

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

/* -------------------------------------------------------------------------- */
/* Day-of-week + relative-age helpers (used by glance bar, sidebars, cards)   */
/* -------------------------------------------------------------------------- */

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function getDayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

export function fmtAge(mtimeMs: number): string {
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

/* -------------------------------------------------------------------------- */
/* Glance counts                                                              */
/* -------------------------------------------------------------------------- */

export function renderCount(label: string, openCount: number, total: number, tone: string): string {
  const display = total === 0 ? "0" : openCount === total ? `${total}` : `${openCount} / ${total}`;
  return `
    <span class="cockpit-count cockpit-count-${tone}" data-tone="${tone}">
      <span class="cockpit-count-num">${escapeHtml(display)}</span>
      <span class="cockpit-count-label">${escapeHtml(label)}</span>
    </span>
  `;
}

/**
 * Progress bar for the main column. CSS uses `--pct` to render the filled
 * portion in `--cockpit-done`. 0% (no tasks) renders as an empty track; 100%
 * renders fully filled. The percentage is also surfaced as text for screen
 * readers and as a small badge on the right.
 */
export function renderProgressBar(done: number, total: number): string {
  if (total === 0) {
    return `<div class="cockpit-progress" aria-hidden="true"><div class="cockpit-progress-bar" style="--pct:0"></div><div class="cockpit-progress-label muted">No tasks listed</div></div>`;
  }
  const pct = Math.round((done / total) * 100);
  return `
    <div class="cockpit-progress" role="progressbar" aria-valuenow="${done}" aria-valuemin="0" aria-valuemax="${total}" aria-label="Tasks done">
      <div class="cockpit-progress-bar" style="--pct:${pct}"></div>
      <div class="cockpit-progress-label">${done} of ${total} tasks done${pct === 100 ? " — all clear" : ""}</div>
    </div>
  `;
}

/* -------------------------------------------------------------------------- */
/* Decision card                                                              */
/* -------------------------------------------------------------------------- */

export interface DecisionCardOpts {
  editable: boolean;
}

export function renderDecisionCard(d: Decision, opts: DecisionCardOpts): string {
  const decidedNote = d.decided
    ? `<p class="cockpit-decision-decided-note">Decided: <strong>Option ${escapeHtml(d.decidedOption || "")}</strong>${d.decidedAt ? ` — ${escapeHtml(d.decidedAt)}` : ""}</p>`
    : "";

  // Synthetic / no-options case: show the question + body prose verbatim,
  // no option buttons. Used for "Open ask"-style asks where the producer
  // emitted a single H2 with prose instead of A/B/C structure.
  if (d.options.length === 0) {
    const body = d.bodyMarkdown ? md.render(d.bodyMarkdown) : "";
    return `
      <article class="cockpit-card cockpit-decision cockpit-decision-ask" data-decision-index="${d.index}" data-decided="${d.decided ? "true" : "false"}">
        <h3 class="cockpit-decision-question">${escapeHtml(d.question)}</h3>
        ${decidedNote}
        <div class="cockpit-decision-ask-body rendered-markdown">${body}</div>
      </article>
    `;
  }

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

  const recommendation =
    !d.decided && d.recommendationLetter
      ? `<p class="cockpit-decision-rec"><strong>Recommendation:</strong> Option ${escapeHtml(d.recommendationLetter)}${d.recommendationBody ? ` — ${md.renderInline(d.recommendationBody)}` : ""}</p>`
      : "";

  // Inline body context (paragraphs that aren't options or recommendation).
  const contextBody = d.bodyMarkdown && d.bodyMarkdown.length > 0
    ? `<div class="cockpit-decision-context rendered-markdown">${md.render(d.bodyMarkdown)}</div>`
    : "";

  return `
    <article class="cockpit-card cockpit-decision" data-decision-index="${d.index}" data-decided="${d.decided ? "true" : "false"}">
      <h3 class="cockpit-decision-question">${escapeHtml(d.question)}</h3>
      ${decidedNote}
      ${contextBody}
      <div class="cockpit-decision-options" role="group" aria-label="Decision options">
        ${optionButtons}
      </div>
      ${recommendation}
      <div class="cockpit-decision-status" role="status" aria-live="polite"></div>
    </article>
  `;
}

/* -------------------------------------------------------------------------- */
/* Task buckets and tasks                                                     */
/* -------------------------------------------------------------------------- */

export function semanticToTone(s: TaskSemantic): string {
  if (s === "p0") return "critical";
  if (s === "p1") return "action";
  if (s === "p2") return "context";
  if (s === "watch") return "waiting";
  if (s === "stale") return "waiting";
  return "context";
}

export interface TaskBucketOpts {
  defaultOpen: boolean;
  editable: boolean;
}

export function renderTaskBucket(b: TaskBucket, opts: TaskBucketOpts): string {
  const tone = semanticToTone(b.semantic);
  const doneCount = b.tasks.filter((t) => t.done).length;
  const totalCount = b.tasks.length;
  const label = b.label || "Tasks";
  const openAttr = opts.defaultOpen ? " open" : "";
  const tasksHtml = b.tasks.map((t) => renderTask(t, { editable: opts.editable })).join("\n");

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

export interface TaskRowOpts {
  editable: boolean;
}

export function renderTask(t: PlanTask, opts: TaskRowOpts): string {
  const checked = t.done ? " checked" : "";
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

/**
 * Compact task row for the MUST DO TODAY region — flat row, no bucket
 * surround, tighter spacing. Used when a P0 task gets promoted alongside
 * a decision card. Same data-original-text + checkbox semantics as the
 * full row, so all existing JS handlers work unchanged.
 */
export function renderTaskCompact(t: PlanTask, opts: TaskRowOpts): string {
  const checked = t.done ? " checked" : "";
  const inlineBody = stripListWrapper(t.rendered);
  const doneBadge = t.done && t.doneTimestamp
    ? `<span class="cockpit-task-done-badge">${escapeHtml(t.doneTimestamp)}</span>`
    : "";
  const editableAttr = opts.editable ? "" : " data-readonly=\"true\"";
  return `
    <li class="cockpit-task cockpit-task-compact${t.done ? " cockpit-task-done" : ""}" data-task-index="${t.index}" data-original-text="${escapeAttr(t.rawText)}"${editableAttr}>
      <label class="cockpit-task-label">
        <input type="checkbox" class="cockpit-task-check"${checked}${opts.editable ? "" : " disabled"} aria-label="Mark task ${t.index + 1} ${t.done ? "not done" : "done"}">
        <span class="cockpit-task-body">${inlineBody}</span>
        ${doneBadge}
      </label>
      <span class="cockpit-task-status" role="status" aria-live="polite"></span>
    </li>
  `;
}

export function stripListWrapper(html: string): string {
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
/* Drafts region passthrough                                                  */
/* -------------------------------------------------------------------------- */

export function renderDraftsRegion(draftsHtml: string): string {
  if (!draftsHtml || draftsHtml.trim() === "") {
    return `
      <section class="cockpit-region cockpit-region-drafts cockpit-region-empty" data-region="drafts" aria-label="Drafts">
        <h2 class="cockpit-region-title">DRAFTS</h2>
        <p class="cockpit-region-empty-msg">No drafts in this plan.</p>
      </section>
    `;
  }
  return `
    <section class="cockpit-region cockpit-region-drafts" data-region="drafts" aria-label="Drafts">
      <h2 class="cockpit-region-title">DRAFTS</h2>
      <div class="cockpit-drafts-body rendered-markdown">${draftsHtml}</div>
    </section>
  `;
}

export function countDrafts(draftsHtml: string): number {
  if (!draftsHtml) return 0;
  const matches = draftsHtml.match(/class="draft-actions"/g);
  return matches ? matches.length : 0;
}

export function countSentToday(draftsHtml: string): number {
  if (!draftsHtml) return 0;
  const matches = draftsHtml.match(/class="draft-actions draft-actions-sent"/g);
  return matches ? matches.length : 0;
}

/* -------------------------------------------------------------------------- */
/* Sidebar primitives (v0.9+)                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generic sidebar list row: small status dot + text (truncated to one line)
 * + optional time/age suffix. Used by both sidebars for consistent rhythm.
 */
export function renderSidebarItem(opts: {
  tone: string;            // "critical" | "action" | "done" | "context" | "waiting"
  text: string;            // already-rendered inline HTML safe for inclusion
  suffix?: string;         // e.g. "11:14 EDT"
  href?: string;           // optional link
  title?: string;          // optional title attribute
}): string {
  const dot = `<span class="cockpit-aside-dot cockpit-aside-dot-${opts.tone}" aria-hidden="true"></span>`;
  const suffix = opts.suffix ? `<span class="cockpit-aside-suffix">${escapeHtml(opts.suffix)}</span>` : "";
  const titleAttr = opts.title ? ` title="${escapeAttr(opts.title)}"` : "";
  const inner = `${dot}<span class="cockpit-aside-text">${opts.text}</span>${suffix}`;
  if (opts.href) {
    return `<li class="cockpit-aside-row"><a href="${escapeAttr(opts.href)}"${titleAttr} class="cockpit-aside-link">${inner}</a></li>`;
  }
  return `<li class="cockpit-aside-row"${titleAttr}>${inner}</li>`;
}

/**
 * Project list row for the left sidebar. Status drives the dot color via the
 * existing `--cockpit-*` palette. Long names truncate with ellipsis at 28px
 * row height.
 */
export interface ProjectListRow {
  id: string;
  source: string;
  name: string;
  status: string;          // "active" | "paused" | "completed" | "archived" | "ongoing" | "new" | "superseded"
}

export function renderProjectListItem(p: ProjectListRow): string {
  const tone = projectStatusToTone(p.status);
  const href = `/projects/${encodeURIComponent(p.source)}/${encodeURIComponent(p.id)}`;
  return renderSidebarItem({
    tone,
    text: escapeHtml(p.name),
    href,
    title: `${p.name} — ${p.status}`,
  });
}

function projectStatusToTone(status: string): string {
  switch (status) {
    case "active":
    case "ongoing":
      return "action";
    case "paused":
      return "waiting";
    case "new":
      return "critical";
    case "completed":
      return "done";
    case "archived":
    case "superseded":
      return "context";
    default:
      return "context";
  }
}

/**
 * Empty-state for any sidebar widget. Italic muted text.
 */
export function renderAsideEmpty(message: string): string {
  return `<p class="cockpit-aside-empty">${escapeHtml(message)}</p>`;
}
