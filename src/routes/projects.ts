import { Hono } from "hono";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import type { ConsoleConfig, WorkspaceConfig } from "../config.js";
import { getProjectPath } from "../config.js";
import {
  loadProjectIndex,
  getProjectById,
  getAllTags,
  filterProjects,
} from "../parsers/yaml.js";
import { readAndRenderMarkdown } from "../parsers/markdown.js";
import { layout } from "../views/layout.js";
import { projectListView } from "../views/project-list.js";
import { projectDetailView } from "../views/project-detail.js";
import { sessionDetailView } from "../views/session.js";
import { escapeHtml, sanitizePathSegment } from "../utils.js";

export function projectRoutes(config: ConsoleConfig) {
  const app = new Hono();

  function resolveWorkspace(wsName?: string): WorkspaceConfig {
    if (wsName) {
      const ws = config.workspaces.find((w) => w.name === wsName);
      if (ws) return ws;
    }
    return config.workspaces[0];
  }

  // Project list / dashboard
  app.get("/projects", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const projects = loadProjectIndex(ws);
    const allTags = getAllTags(projects);

    const filters = {
      status: c.req.query("status"),
      tag: c.req.query("tag"),
      client: c.req.query("client"),
      q: c.req.query("q"),
    };

    const hasFilters = Object.values(filters).some((v) => v);
    const displayed = hasFilters ? filterProjects(projects, filters) : projects;

    const content = projectListView({
      projects: displayed,
      allTags,
      currentFilters: filters,
      workspace: ws.name,
      demoMode: config.demoMode,
    });

    return c.html(
      layout({
        title: "Projects",
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: "/projects",
      })
    );
  });

  // Project detail
  app.get("/projects/:id", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const projectId = sanitizePathSegment(c.req.param("id"));

    if (!projectId) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Not found</h1><p><a href="/projects?ws=${escapeHtml(ws.name)}">Back to projects</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/projects",
          }),
        404
      );
    }

    const projects = loadProjectIndex(ws);
    const project = getProjectById(projects, projectId);

    if (!project) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Project not found</h1><p>No project with ID "${escapeHtml(projectId)}" exists.</p><p><a href="/projects?ws=${escapeHtml(ws.name)}">Back to projects</a></p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/projects",
          }),
        404
      );
    }

    const projectDir = getProjectPath(ws, projectId);
    const contextHtml = readAndRenderMarkdown(join(projectDir, "CONTEXT.md"));
    const referenceHtml = readAndRenderMarkdown(join(projectDir, "REFERENCE.md"));

    // List sessions
    const sessionsDir = join(projectDir, "sessions");
    const sessions: { name: string; period: string }[] = [];
    if (existsSync(sessionsDir)) {
      const files = readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .reverse();
      for (const f of files) {
        const period = f.replace(".md", "");
        sessions.push({ name: period, period });
      }
    }

    const content = projectDetailView({
      project,
      contextHtml,
      referenceHtml,
      sessions,
      workspace: ws.name,
    });

    return c.html(
      layout({
        title: project.name,
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: `/projects/${projectId}`,
      })
    );
  });

  // Session detail
  app.get("/projects/:id/sessions/:period", (c) => {
    const ws = resolveWorkspace(c.req.query("ws"));
    const projectId = sanitizePathSegment(c.req.param("id"));
    const period = sanitizePathSegment(c.req.param("period"));

    if (!projectId || !period) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Not found</h1>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/projects",
          }),
        404
      );
    }

    const projects = loadProjectIndex(ws);
    const project = getProjectById(projects, projectId);

    if (!project) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Project not found</h1>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: "/projects",
          }),
        404
      );
    }

    const sessionFile = join(
      getProjectPath(ws, projectId),
      "sessions",
      `${period}.md`
    );
    const contentHtml = readAndRenderMarkdown(sessionFile);

    if (!contentHtml) {
      return c.html(
        layout({
          title: "Not Found",
          content: `<h1>Session not found</h1><p>No session file for period "${escapeHtml(period)}".</p>`,
          workspaces: config.workspaces,
          currentWorkspace: ws.name,
          currentPath: `/projects/${projectId}`,
          }),
        404
      );
    }

    const content = sessionDetailView({
      projectId,
      projectName: project.name,
      period,
      contentHtml,
      workspace: ws.name,
    });

    return c.html(
      layout({
        title: `${project.name} — Session ${period}`,
        content,
        workspaces: config.workspaces,
        currentWorkspace: ws.name,
        currentPath: `/projects/${projectId}/sessions`,
      })
    );
  });

  return app;
}
