import { Hono } from "hono";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { ConsoleConfig, Source } from "../config.js";
import { getPlansPath, findSource } from "../config.js";
import { readAndRenderPlanMarkdown } from "../parsers/markdown.js";
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
    const contentHtml = readAndRenderPlanMarkdown(filePath);
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

  return app;
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
