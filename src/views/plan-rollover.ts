/**
 * Rollover view — tasks carried across multiple daily plans.
 *
 * Renders a sortable list of priority tasks that have appeared in multiple
 * plans without being marked done. Pulls from `findCarryoverTasks()` in the
 * plan-rollover parser.
 *
 * Layout:
 *   - Header with breadcrumb and the source / threshold context
 *   - Threshold chips (7 / 14 / 30 days) — query-param links, no JS state
 *   - Card per task: exemplar text, days-carried badge, first-seen date,
 *     count of appearances, and a sparkline-style list of occurrence dates
 *     (each linked to its plan)
 *
 * Empty-state messaging communicates that empty == healthy: nothing has been
 * carried more than the threshold, which usually means tasks are either
 * shipping or being explicitly de-prioritized within the window.
 */
import type { RolloverTask } from "../parsers/plan-rollover.js";
import { escapeHtml, escapeAttr } from "../utils.js";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayOfWeek(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}

export interface RolloverViewOpts {
  sourceName: string;
  sourceDisplayName?: string;
  asOfDate: string;
  minDays: number;
  windowDays: number;
  tasks: RolloverTask[];
  /** Other available threshold options; current threshold is highlighted. */
  thresholdOptions: number[];
}

export function planRolloverView(opts: RolloverViewOpts): string {
  const display = opts.sourceDisplayName || opts.sourceName;
  const planLink = (date: string) =>
    `/plans/${encodeURIComponent(opts.sourceName)}/${encodeURIComponent(date)}`;

  const chips = opts.thresholdOptions
    .map((n) => {
      const active = n === opts.minDays ? " cockpit-filter-active" : "";
      const url = `?days=${n}`;
      return `<a class="cockpit-filter-chip${active}" href="${escapeAttr(url)}" rel="nofollow">≥ ${n} days</a>`;
    })
    .join("\n");

  const totalOpen = opts.tasks.filter((t) => t.currentlyOpen).length;
  const totalClosed = opts.tasks.length - totalOpen;

  const summary = `
    <div class="cockpit-glance" role="region" aria-label="Rollover summary">
      <div class="cockpit-glance-title">
        <strong>Tasks carried ≥ ${opts.minDays} days</strong>
        <span class="cockpit-glance-age">As of ${escapeHtml(opts.asOfDate)} (${escapeHtml(dayOfWeek(opts.asOfDate))})</span>
      </div>
      <div class="cockpit-glance-counts">
        ${renderCount("Carrying", totalOpen, totalOpen, "critical")}
        ${renderCount("Window", opts.windowDays, opts.windowDays, "context")}
      </div>
      <div class="cockpit-glance-tools">
        <div class="cockpit-filter-chips" role="group" aria-label="Threshold">
          ${chips}
        </div>
      </div>
    </div>
  `;

  const cards = opts.tasks.length === 0
    ? renderEmpty(opts)
    : opts.tasks.map((t) => renderCard(t, planLink)).join("\n");

  const closedNote = opts.tasks.length === 0 || totalClosed === 0
    ? ""
    : `<p class="cockpit-region-empty-msg" style="text-align:left">${totalClosed} of these closed before today and remain in this view for context — toggle the threshold or scope as needed.</p>`;

  return `
    <div class="cockpit-view cockpit-rollover" data-source="${escapeAttr(opts.sourceName)}">
      <nav aria-label="breadcrumb" class="cockpit-breadcrumb">
        <ul>
          <li><a href="/plans">Daily Plans</a></li>
          <li><span class="source-badge">${escapeHtml(display)}</span></li>
          <li>Rollover (≥ ${opts.minDays} days)</li>
        </ul>
      </nav>

      ${summary}

      <section class="cockpit-region cockpit-region-today" aria-label="Carryover tasks">
        <h2 class="cockpit-region-title">CARRYING
          <span class="cockpit-region-count">${opts.tasks.length} task${opts.tasks.length === 1 ? "" : "s"}</span>
        </h2>
        ${closedNote}
        ${cards}
      </section>
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

function renderEmpty(opts: RolloverViewOpts): string {
  return `
    <article class="cockpit-card cockpit-decision-ask">
      <p class="cockpit-region-empty-msg">
        No tasks have been carrying for ≥ ${opts.minDays} days within the last
        ${opts.windowDays} days. Either tasks are shipping, getting explicitly
        de-prioritized, or the window is too narrow — try a smaller threshold
        above.
      </p>
    </article>
  `;
}

function renderCard(t: RolloverTask, planLink: (date: string) => string): string {
  const occurrenceList = t.occurrences
    .map((o) => {
      const cls = o.done ? "cockpit-rollover-occurrence cockpit-rollover-done" : "cockpit-rollover-occurrence";
      const title = o.done
        ? `Marked done${o.doneTimestamp ? " at " + o.doneTimestamp : ""}`
        : "Open on this day";
      return `<a class="${cls}" href="${escapeAttr(planLink(o.date))}" title="${escapeAttr(title)}">${escapeHtml(o.date)}</a>`;
    })
    .join(" ");

  const stateBadge = t.currentlyOpen
    ? `<span class="cockpit-decision-rec-badge" style="background:var(--cockpit-critical);color:#fff">Open today</span>`
    : `<span class="cockpit-decision-rec-badge">Closed</span>`;

  const tone = t.currentlyOpen ? "cockpit-bucket-critical" : "cockpit-bucket-other";

  return `
    <article class="cockpit-card cockpit-decision ${tone}" data-days-carried="${t.daysCarried}">
      <div class="cockpit-rollover-meta">
        <span class="cockpit-count cockpit-count-critical">
          <span class="cockpit-count-num">${t.daysCarried}</span>
          <span class="cockpit-count-label">days carried</span>
        </span>
        ${stateBadge}
      </div>
      <h3 class="cockpit-decision-question">${escapeHtml(t.exemplarText)}</h3>
      <div class="cockpit-rollover-trail">
        <div class="cockpit-rollover-trail-label">
          First seen <a href="${escapeAttr(planLink(t.firstSeenDate))}">${escapeHtml(t.firstSeenDate)}</a>;
          appeared in ${t.occurrenceCount} plan${t.occurrenceCount === 1 ? "" : "s"};
          last open <a href="${escapeAttr(planLink(t.lastOpenDate))}">${escapeHtml(t.lastOpenDate)}</a>.
        </div>
        <div class="cockpit-rollover-occurrences">${occurrenceList}</div>
      </div>
    </article>
  `;
}
