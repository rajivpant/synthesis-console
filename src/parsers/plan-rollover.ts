/**
 * Cross-day rollover detection.
 *
 * Walks the daily plans directory for one source, parses the priority-tasks
 * section of each plan, and identifies tasks that have been "carried" — i.e.
 * the same task appears in multiple plans without being marked done.
 *
 * Carryover is a self-awareness signal. Anything that lives on the priority
 * list day after day without moving to done is a candidate to either (a) ship
 * today, (b) explicitly de-prioritize (move out of priority-tasks), or (c)
 * reframe (the task is malformed and that's why it never closes).
 *
 * Identity model
 * --------------
 * Two task list-items are "the same task" if their normalized text matches
 * exactly. The normalization strips:
 *   - leading list markers (`1. ` / `- [ ] ` / `- [x] `)
 *   - strikethrough markers (`~~`)
 *   - the `✅ DONE HH:MM TZ` and `✅ SENT HH:MM TZ` markers
 *   - bold/italic markup
 *   - em-dash and surrounding whitespace
 *   - punctuation (preserves alphanumeric + spaces)
 *   - case
 *
 * This is deliberately tolerant — Rajiv's tasks tend to keep their leading
 * bold title across days even as the trailing context changes ("Reply to X on
 * Y" stays the same; the ", in #channel" detail may rotate). The leading
 * substring through the first em-dash is the most stable identity. We use up
 * to 200 normalized chars as the key; tasks longer than that are still
 * matched by the head.
 *
 * Edge cases handled by design:
 *   - A task that's done in one plan but reopens in a later plan is
 *     reported as carrying the firstSeenDate of the earliest open occurrence.
 *   - A task that was once done and is still done in the latest plan is NOT
 *     reported (it's not currently carrying).
 *   - Tasks in different priority buckets (P0 vs Stale vs Watch) within the
 *     same plan are kept distinct only by their text, not their bucket — a
 *     task that moves from "Do today" to "Stale" is the same task.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { join } from "path";
import { findPlanSections, collectAllTasks } from "./plan-sections.js";
import type { PlanTask } from "./plan-sections.js";

export interface RolloverOccurrence {
  date: string;
  done: boolean;
  /** Original raw text of the list item from that day's plan. */
  rawText: string;
  /** Done timestamp if any (e.g. "11:14 EDT"). */
  doneTimestamp?: string;
}

export interface RolloverTask {
  /** Normalization key — stable across days. */
  normalized: string;
  /** Most recent rendered HTML form (for display). */
  exemplarHtml: string;
  /** Most recent raw text (for display fallback). */
  exemplarText: string;
  /** Earliest date this task appeared (in any state). YYYY-MM-DD. */
  firstSeenDate: string;
  /** Most recent date the task appeared in any plan, in any state. */
  lastSeenDate: string;
  /** Most recent date the task was open (not done). */
  lastOpenDate: string;
  /** Days carried = today (or asOfDate) minus firstSeenDate, inclusive. */
  daysCarried: number;
  /** Total number of plans this task appeared in. */
  occurrenceCount: number;
  /** All occurrences, oldest first. */
  occurrences: RolloverOccurrence[];
  /** Whether the task is currently open (latest occurrence is not done). */
  currentlyOpen: boolean;
}

export interface RolloverOptions {
  /** Minimum days carried to include in the result. Default 7. */
  minDays?: number;
  /** Date to compute "today" against (YYYY-MM-DD). Defaults to local today. */
  asOfDate?: string;
  /** Only consider plans with this date or earlier. Defaults to asOfDate. */
  upToDate?: string;
  /** How many days back to scan. Default 60. */
  windowDays?: number;
  /** Only return tasks that are currently open (default true). */
  openOnly?: boolean;
}

const DEFAULT_OPTIONS: Required<Omit<RolloverOptions, "upToDate" | "asOfDate">> = {
  minDays: 7,
  windowDays: 60,
  openOnly: true,
};

/**
 * Strip the leading list marker (numbered or checkbox) from a task line.
 */
function stripListMarker(s: string): string {
  return s
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/^\s*[-*+]\s+/, "");
}

/**
 * Normalize a task's raw text into an identity key.
 *
 * Conservative on length (cap at 200 chars) so that long appended notes
 * ("after the meeting on Thursday — see #channel") don't fragment what would
 * otherwise be the same task across days.
 */
export function normalizeTaskText(rawText: string): string {
  // Take the first physical line — the task title. Continuation lines are
  // context, not identity.
  const firstLine = (rawText.split("\n")[0] || "").trim();
  let s = stripListMarker(firstLine);
  s = s
    .replace(/~~/g, "")
    // Strip "✅ **DONE 11:14 EDT**" / "✅ **SENT 10:30 EDT**" markers
    .replace(/✅\s*\*\*[^*]+\*\*/g, "")
    .replace(/✅/g, "")
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/`/g, "")
    .replace(/\s*[—–-]\s*/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return s.slice(0, 200);
}

function diffDaysInclusive(earlier: string, later: string): number {
  // Both YYYY-MM-DD. Treat as UTC-midnight to avoid tz drift.
  const a = Date.parse(earlier + "T00:00:00Z");
  const b = Date.parse(later + "T00:00:00Z");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const oneDay = 86_400_000;
  return Math.max(0, Math.floor((b - a) / oneDay));
}

function todayLocalDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

interface PlanFile {
  date: string;
  filePath: string;
}

function listPlanFiles(plansDir: string, upToDate: string, windowDays: number): PlanFile[] {
  if (!existsSync(plansDir)) return [];
  const files = readdirSync(plansDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  const cutoff = new Date(Date.parse(upToDate + "T00:00:00Z"));
  cutoff.setUTCDate(cutoff.getUTCDate() - windowDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return files
    .map((f) => ({ date: f.replace(/\.md$/, ""), filePath: join(plansDir, f) }))
    .filter((p) => p.date >= cutoffStr && p.date <= upToDate)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function extractTasks(filePath: string): PlanTask[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const sections = findPlanSections(raw);
  return collectAllTasks(sections);
}

/**
 * Find tasks carried across multiple plans.
 *
 * Returns tasks sorted by (currentlyOpen desc, daysCarried desc, lastSeenDate desc).
 */
export function findCarryoverTasks(
  plansDir: string,
  opts: RolloverOptions = {}
): RolloverTask[] {
  const asOfDate = opts.asOfDate || todayLocalDate();
  const upToDate = opts.upToDate || asOfDate;
  const minDays = opts.minDays ?? DEFAULT_OPTIONS.minDays;
  const windowDays = opts.windowDays ?? DEFAULT_OPTIONS.windowDays;
  const openOnly = opts.openOnly ?? DEFAULT_OPTIONS.openOnly;

  const files = listPlanFiles(plansDir, upToDate, windowDays);
  if (files.length === 0) return [];

  // Map normalized → accumulating data.
  const acc = new Map<
    string,
    {
      exemplarHtml: string;
      exemplarText: string;
      firstSeenDate: string;
      lastSeenDate: string;
      lastOpenDate: string;
      occurrences: RolloverOccurrence[];
    }
  >();

  for (const pf of files) {
    const tasks = extractTasks(pf.filePath);
    for (const t of tasks) {
      const norm = normalizeTaskText(t.rawText);
      if (norm.length === 0) continue;
      let entry = acc.get(norm);
      if (!entry) {
        entry = {
          exemplarHtml: t.rendered,
          exemplarText: (t.rawText.split("\n")[0] || "").trim(),
          firstSeenDate: pf.date,
          lastSeenDate: pf.date,
          lastOpenDate: t.done ? "" : pf.date,
          occurrences: [],
        };
        acc.set(norm, entry);
      } else {
        // Earliest first, latest last (files are sorted ascending).
        entry.lastSeenDate = pf.date;
        if (!t.done) entry.lastOpenDate = pf.date;
        entry.exemplarHtml = t.rendered;
        entry.exemplarText = (t.rawText.split("\n")[0] || "").trim();
      }
      entry.occurrences.push({
        date: pf.date,
        done: t.done,
        rawText: t.rawText,
        doneTimestamp: t.doneTimestamp,
      });
    }
  }

  const out: RolloverTask[] = [];
  for (const [normalized, entry] of acc) {
    const latest = entry.occurrences[entry.occurrences.length - 1];
    const currentlyOpen = !!latest && !latest.done;
    if (openOnly && !currentlyOpen) continue;
    const daysCarried = diffDaysInclusive(entry.firstSeenDate, asOfDate);
    if (daysCarried < minDays) continue;
    if (entry.occurrences.length < 2) {
      // A single occurrence isn't a carryover by definition (it appeared once).
      // The minDays check would already exclude it for new tasks; this guard
      // catches the case where one isolated task is older than minDays but
      // was reset (added today, dated today, never carried).
      continue;
    }
    out.push({
      normalized,
      exemplarHtml: entry.exemplarHtml,
      exemplarText: entry.exemplarText,
      firstSeenDate: entry.firstSeenDate,
      lastSeenDate: entry.lastSeenDate,
      lastOpenDate: entry.lastOpenDate || entry.lastSeenDate,
      daysCarried,
      occurrenceCount: entry.occurrences.length,
      occurrences: entry.occurrences,
      currentlyOpen,
    });
  }

  out.sort((a, b) => {
    if (a.currentlyOpen !== b.currentlyOpen) return a.currentlyOpen ? -1 : 1;
    if (a.daysCarried !== b.daysCarried) return b.daysCarried - a.daysCarried;
    return b.lastSeenDate.localeCompare(a.lastSeenDate);
  });

  return out;
}

/**
 * Convenience: count of currently-open carryover tasks ≥ minDays old. Used by
 * the cockpit glance bar to surface a "X carrying" badge with a link to the
 * full rollover view.
 */
export function countCarryoverTasks(
  plansDir: string,
  opts: RolloverOptions = {}
): number {
  return findCarryoverTasks(plansDir, opts).length;
}

/**
 * Stat the most recently-modified plan file in the directory. Used by the
 * rollover view as a cheap freshness indicator.
 */
export function plansDirMtime(plansDir: string): number {
  if (!existsSync(plansDir)) return 0;
  const files = readdirSync(plansDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f));
  let latest = 0;
  for (const f of files) {
    try {
      const m = statSync(join(plansDir, f)).mtimeMs;
      if (m > latest) latest = m;
    } catch {
      // ignore
    }
  }
  return latest;
}
