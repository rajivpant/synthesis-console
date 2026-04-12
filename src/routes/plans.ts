import { Hono } from "hono";
import { existsSync, readdirSync } from "fs";
import type { ConsoleConfig, WorkspaceConfig } from "../config.js";
import { getPlansPath } from "../config.js";
import { readAndRenderPlanMarkdown } from "../parsers/markdown.js";
import { layout } from "../views/layout.js";
import { planListView, planDetailView } from "../views/plan.js";
import type { PlanEntry } from "../views/plan.js";
import { escapeHtml, sanitizePathSegment } from "../utils.js";

function parsePlanFilename(filename: string): PlanEntry | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})\.md$/);
  if (!match) return null;
  const date = match[1];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const [y, m, d] = date.split("-").map(Number);
  const dayOfWeek = DAYS[new Date(y, m - 1, d).getDay()];
  return { date, filename, dayOfWeek };
}

export function planRoutes(config: ConsoleConfig) {
  const app = new Hono();

  function resolveWorkspace(wsName?: string): WorkspaceConfig {
    if (wsName) {
      const ws = config.workspaces.find((w) => w.name === wsName);
      if (ws) return ws;
    }
    return config.workspaces[0];
  }

  function loadPlans(ws: WorkspaceConfig): PlanEntry[] {
    const plansDir = getPlansPath(ws);
    if (!existsSync(plansDir)) return [];

    const files = readdirSync(plansDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .reverse();

    const plans: PlanEntry[] = [];
    for (const f of files) {
      const entry = parsePlanFilename(f);
      if (entry) plans.push(entry);
    }
    return plans;
  }

  // Plan list with calendar
  app.get("/plans", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const plans = loadPlans(ws);

    const content = planListView({
      plans,
      workspace: ws.name,
    });

    return c.html(
      layout({
        title: "Daily Plans",
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: "/plans",
      })
    );
  });

  // Plan detail
  app.get("/plans/:date", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const date = sanitizePathSegment(c.req.param("date"));

    if (!date) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Not found</h1><p><a href="/plans?ws=${escapeHtml(ws.name)}">Back to plans</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/plans",
        }),
        404
      );
    }

    const plansDir = getPlansPath(ws);
    const filePath = `${plansDir}/${date}.md`;
    const contentHtml = readAndRenderPlanMarkdown(filePath);

    if (!contentHtml) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>No plan for ${escapeHtml(date)}</h1><p><a href="/plans?ws=${escapeHtml(ws.name)}">Back to plans</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/plans",
        }),
        404
      );
    }

    // Find prev/next plans for navigation
    const allPlans = loadPlans(ws);
    const sortedAsc = [...allPlans].sort((a, b) => a.date.localeCompare(b.date));
    const currentIdx = sortedAsc.findIndex((p) => p.date === date);
    const prevDate = currentIdx > 0 ? sortedAsc[currentIdx - 1].date : undefined;
    const nextDate = currentIdx < sortedAsc.length - 1 ? sortedAsc[currentIdx + 1].date : undefined;

    const content = planDetailView({
      date,
      contentHtml,
      workspace: ws.name,
      prevDate,
      nextDate,
    });

    return c.html(
      layout({
        title: `Plan — ${date}`,
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: `/plans/${date}`,
      })
    );
  });

  return app;
}
