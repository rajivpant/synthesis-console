import type { Source } from "../config.js";
import { escapeHtml, escapeAttr } from "../utils.js";

export interface PlanEntry {
  date: string;
  filename: string;
  dayOfWeek: string;
  source: string;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function getDayOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return DAYS[date.getDay()];
}

function getToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function planListView(opts: {
  plans: PlanEntry[];
  sources: Source[];
}): string {
  const { plans, sources } = opts;
  const today = getToday();
  const multiSource = new Set(plans.map((p) => p.source)).size > 1;

  if (plans.length === 0) {
    const hasPlanSource = sources.some((s) => s.plans_dir);
    const message = hasPlanSource
      ? `No daily action plans found in the selected sources.`
      : `None of the selected sources provide daily plans. Declare plans_dir on a source to add them.`;
    return `<h1>Daily Plans</h1><p>${message}</p>`;
  }

  // Group plans by month, selecting one source per date for the calendar (the first source's plan "wins" visually;
  // but every plan remains linkable from the month list below).
  const byMonth = new Map<string, PlanEntry[]>();
  for (const p of plans) {
    const month = p.date.slice(0, 7);
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(p);
  }

  const months = [...byMonth.keys()].sort().reverse();

  const sections = months
    .map((month) => {
      const monthPlans = byMonth.get(month)!;
      const [y, m] = month.split("-").map(Number);
      const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      const calendarHtml = buildCalendarGrid(y, m, monthPlans, today);
      const duplicatesHtml = multiSource ? renderDuplicates(monthPlans) : "";

      return `
        <section class="plan-month">
          <h2>${escapeHtml(monthName)}</h2>
          ${calendarHtml}
          ${duplicatesHtml}
        </section>
      `;
    })
    .join("\n");

  const todayPlans = plans.filter((p) => p.date === today);
  const todayLink =
    todayPlans.length === 0
      ? `<span class="today-link muted">No plan for today</span>`
      : todayPlans.length === 1
        ? `<a href="/plans/${encodeURIComponent(todayPlans[0].source)}/${todayPlans[0].date}" class="today-link">View today's plan</a>`
        : `<span class="today-link">Today's plans: ${todayPlans
            .map(
              (p) =>
                `<a href="/plans/${encodeURIComponent(p.source)}/${p.date}">${escapeHtml(p.source)}</a>`
            )
            .join(", ")}</span>`;

  return `
    <h1>Daily Plans</h1>
    <div class="plan-today-bar">${todayLink}</div>
    ${sections}
  `;
}

function buildCalendarGrid(
  year: number,
  month: number,
  plans: PlanEntry[],
  today: string
): string {
  // Choose one source per date for the calendar link (first encountered). Duplicates are listed below.
  const planByDate = new Map<string, PlanEntry>();
  for (const p of plans) {
    if (!planByDate.has(p.date)) planByDate.set(p.date, p);
  }

  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  let cells = "";
  for (let i = 0; i < firstDay; i++) {
    cells += `<td class="cal-empty"></td>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const plan = planByDate.get(dateStr);
    const isToday = dateStr === today;

    let classes = "cal-day";
    if (isToday) classes += " cal-today";
    if (plan) classes += " cal-has-plan";

    const content = plan
      ? `<a href="/plans/${encodeURIComponent(plan.source)}/${dateStr}">${day}</a>`
      : `${day}`;

    cells += `<td class="${classes}">${content}</td>`;

    if ((firstDay + day) % 7 === 0 && day < daysInMonth) {
      cells += `</tr><tr>`;
    }
  }

  return `
    <table class="calendar-grid">
      <thead>
        <tr><th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th></tr>
      </thead>
      <tbody>
        <tr>${cells}</tr>
      </tbody>
    </table>
  `;
}

function renderDuplicates(plans: PlanEntry[]): string {
  const byDate = new Map<string, PlanEntry[]>();
  for (const p of plans) {
    if (!byDate.has(p.date)) byDate.set(p.date, []);
    byDate.get(p.date)!.push(p);
  }

  const duplicates = [...byDate.entries()].filter(([, list]) => list.length > 1);
  if (duplicates.length === 0) return "";

  const rows = duplicates
    .map(
      ([date, list]) =>
        `<li><strong>${escapeHtml(date)}</strong>: ${list
          .map(
            (p) =>
              `<a href="/plans/${encodeURIComponent(p.source)}/${p.date}"><span class="source-badge">${escapeHtml(p.source)}</span></a>`
          )
          .join(" ")}</li>`
    )
    .join("\n");

  return `
    <details class="plan-duplicates">
      <summary>Dates with plans from multiple sources (${duplicates.length})</summary>
      <ul>${rows}</ul>
    </details>
  `;
}

export function planDetailView(opts: {
  date: string;
  contentHtml: string;
  sourceName: string;
  prevDate?: string;
  nextDate?: string;
}): string {
  const { date, contentHtml, sourceName, prevDate, nextDate } = opts;
  const dayOfWeek = getDayOfWeek(date);

  const prevLink = prevDate
    ? `<a href="/plans/${encodeURIComponent(sourceName)}/${prevDate}">&larr; ${prevDate}</a>`
    : `<span class="muted">&larr;</span>`;

  const nextLink = nextDate
    ? `<a href="/plans/${encodeURIComponent(sourceName)}/${nextDate}">${nextDate} &rarr;</a>`
    : `<span class="muted">&rarr;</span>`;

  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/plans">Daily Plans</a></li>
        <li><span class="source-badge" title="Source: ${escapeAttr(sourceName)}">${escapeHtml(sourceName)}</span></li>
        <li>${escapeHtml(dayOfWeek)}, ${escapeHtml(date)}</li>
      </ul>
    </nav>

    <div class="plan-nav">
      ${prevLink}
      <strong>${escapeHtml(dayOfWeek)}, ${escapeHtml(date)}</strong>
      ${nextLink}
    </div>

    <div class="rendered-markdown plan-content">
      ${contentHtml}
    </div>
  `;
}
