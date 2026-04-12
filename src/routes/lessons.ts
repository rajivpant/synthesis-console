import { Hono } from "hono";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { ConsoleConfig, WorkspaceConfig } from "../config.js";
import { getLessonsPath } from "../config.js";
import { readAndRenderMarkdown } from "../parsers/markdown.js";
import { layout } from "../views/layout.js";
import { lessonListView, lessonDetailView } from "../views/lesson.js";
import type { LessonEntry } from "../views/lesson.js";
import { escapeHtml, sanitizePathSegment } from "../utils.js";

function parseLessonFilename(filename: string): LessonEntry | null {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.md$/);
  if (!match) return null;

  const date = match[1];
  const slug = match[2];
  const title = slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return { slug: filename.replace(".md", ""), filename, date, title };
}

export function lessonRoutes(config: ConsoleConfig) {
  const app = new Hono();

  function resolveWorkspace(wsName?: string): WorkspaceConfig {
    if (wsName) {
      const ws = config.workspaces.find((w) => w.name === wsName);
      if (ws) return ws;
    }
    return config.workspaces[0];
  }

  // Lessons list
  app.get("/lessons", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const lessonsDir = getLessonsPath(ws);

    const lessons: LessonEntry[] = [];
    if (existsSync(lessonsDir)) {
      const files = readdirSync(lessonsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();

      for (const f of files) {
        const entry = parseLessonFilename(f);
        if (entry) lessons.push(entry);
      }
    }

    const content = lessonListView({ lessons, workspace: ws.name });

    return c.html(
      layout({
        title: "Lessons",
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: "/lessons",
      })
    );
  });

  // Lesson detail
  app.get("/lessons/:slug", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const slug = sanitizePathSegment(c.req.param("slug"));

    if (!slug) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Not found</h1><p><a href="/lessons?ws=${escapeHtml(ws.name)}">Back to lessons</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/lessons",
          }),
        404
      );
    }

    const lessonsDir = getLessonsPath(ws);
    const filePath = join(lessonsDir, `${slug}.md`);

    const contentHtml = readAndRenderMarkdown(filePath);
    if (!contentHtml) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Lesson not found</h1><p><a href="/lessons?ws=${escapeHtml(ws.name)}">Back to lessons</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/lessons",
          }),
        404
      );
    }

    const entry = parseLessonFilename(`${slug}.md`);
    const lesson = entry || { slug, filename: `${slug}.md`, date: "", title: slug };

    const content = lessonDetailView({
      lesson,
      contentHtml,
      workspace: ws.name,
    });

    return c.html(
      layout({
        title: lesson.title,
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: `/lessons/${slug}`,
      })
    );
  });

  return app;
}
