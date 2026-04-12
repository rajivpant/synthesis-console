import { escapeHtml, escapeAttr } from "../utils.js";

export interface PlanEntry {
  date: string;
  filename: string;
  dayOfWeek: string;
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
  workspace: string;
  currentMonth?: string;
}): string {
  const { plans, workspace } = opts;
  const today = getToday();

  if (plans.length === 0) {
    return `<h1>Daily Plans</h1><p>No daily action plans found.</p>`;
  }

  // Group plans by month
  const byMonth = new Map<string, PlanEntry[]>();
  for (const p of plans) {
    const month = p.date.slice(0, 7); // YYYY-MM
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month)!.push(p);
  }

  const months = [...byMonth.keys()].sort().reverse();

  // Build month sections
  const sections = months.map((month) => {
    const monthPlans = byMonth.get(month)!;
    const [y, m] = month.split("-").map(Number);
    const monthName = new Date(y, m - 1, 1).toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    // Build calendar grid for this month
    const calendarHtml = buildCalendarGrid(y, m, monthPlans, today, workspace);

    return `
      <section class="plan-month">
        <h2>${escapeHtml(monthName)}</h2>
        ${calendarHtml}
      </section>
    `;
  }).join("\n");

  // Find today's plan for quick link
  const todayPlan = plans.find((p) => p.date === today);
  const todayLink = todayPlan
    ? `<a href="/plans/${todayPlan.date}?ws=${escapeAttr(workspace)}" class="today-link">View today's plan</a>`
    : `<span class="today-link muted">No plan for today</span>`;

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
  today: string,
  workspace: string
): string {
  const planDates = new Set(plans.map((p) => p.date));
  const firstDay = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();

  let cells = "";

  // Empty cells for days before the 1st
  for (let i = 0; i < firstDay; i++) {
    cells += `<td class="cal-empty"></td>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const hasPlan = planDates.has(dateStr);
    const isToday = dateStr === today;

    let classes = "cal-day";
    if (isToday) classes += " cal-today";
    if (hasPlan) classes += " cal-has-plan";

    const content = hasPlan
      ? `<a href="/plans/${dateStr}?ws=${escapeAttr(workspace)}">${day}</a>`
      : `${day}`;

    cells += `<td class="${classes}">${content}</td>`;

    // End of week
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

export function planDetailView(opts: {
  date: string;
  contentHtml: string;
  workspace: string;
  prevDate?: string;
  nextDate?: string;
}): string {
  const { date, contentHtml, workspace, prevDate, nextDate } = opts;
  const dayOfWeek = getDayOfWeek(date);

  const prevLink = prevDate
    ? `<a href="/plans/${prevDate}?ws=${escapeAttr(workspace)}">&larr; ${prevDate}</a>`
    : `<span class="muted">&larr;</span>`;

  const nextLink = nextDate
    ? `<a href="/plans/${nextDate}?ws=${escapeAttr(workspace)}">${nextDate} &rarr;</a>`
    : `<span class="muted">&rarr;</span>`;

  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/plans?ws=${escapeAttr(workspace)}">Daily Plans</a></li>
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
