/**
 * Cockpit view for daily plan detail pages.
 *
 * v0.9.0+: thin shim that forwards to the three-column shell view at
 * `cockpit/shell.ts`. The composition is:
 *
 *   planCockpitView(opts)
 *     → planCockpitShellView(opts)
 *       → renderSidebarLeft (calendar + projects)
 *       → renderMainColumn  (date / progress / tools / MUST DO / DO THIS WEEK / DRAFTS / MORE)
 *       → renderSidebarRight (wins + waiting on)
 *
 * Card primitives (decision card, task row, draft pass-through, sidebar
 * row, project list row, progress bar) live in `cockpit/cards.ts` and are
 * shared across the three column views.
 *
 * Below 1024px the shell collapses to single-column with the sidebars
 * rendered as `<details>` elements above the main content. CSS handles the
 * adaptation; no JS state.
 *
 * The exported `PlanCockpitOpts` shape is backwards-compatible with v0.8 —
 * routes that don't pass `projects` or `plansForCalendar` get empty
 * sidebars but the page still renders correctly.
 */
import { planCockpitShellView } from "./cockpit/shell.js";
import type { PlanCockpitShellOpts } from "./cockpit/shell.js";

export type PlanCockpitOpts = PlanCockpitShellOpts;

export function planCockpitView(opts: PlanCockpitOpts): string {
  return planCockpitShellView(opts);
}
