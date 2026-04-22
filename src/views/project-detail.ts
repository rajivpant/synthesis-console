import type { Project, Initiative } from "../parsers/yaml.js";
import { escapeHtml, escapeAttr } from "../utils.js";

const STATUS_COLORS: Record<string, string> = {
  active: "blue",
  new: "purple",
  paused: "yellow",
  ongoing: "teal",
  completed: "green",
  archived: "gray",
  superseded: "red",
};

export function projectDetailView(opts: {
  project: Project;
  contextHtml: string | null;
  referenceHtml: string | null;
  sessions: { name: string; period: string }[];
  sourceName: string;
  initiative?: Initiative;
}): string {
  const { project: p, contextHtml, referenceHtml, sessions, sourceName, initiative } = opts;

  const statusColor = STATUS_COLORS[p.status] || "gray";

  const tags = (p.tags || [])
    .map(
      (t) =>
        `<a href="/projects?tag=${encodeURIComponent(t)}" class="tag">${escapeHtml(t)}</a>`
    )
    .join(" ");

  const relatedLinks = (p.related || [])
    .map(
      (r) =>
        `<a href="/projects/${encodeURIComponent(sourceName)}/${encodeURIComponent(r)}">${escapeHtml(r)}</a>`
    )
    .join(", ");

  const dates = buildDatesTable(p);
  const sessionsList = renderSessionsList(p.id, sessions, sourceName);

  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/projects">Projects</a></li>
        <li><span class="source-badge" title="Source: ${escapeAttr(sourceName)}">${escapeHtml(sourceName)}</span></li>
        <li>${escapeHtml(p.name)}</li>
      </ul>
    </nav>

    <hgroup>
      <h1>${escapeHtml(p.name)}</h1>
      <p><span class="badge badge-${statusColor}">${escapeHtml(p.status)}</span></p>
    </hgroup>

    <div class="project-detail-layout">
      <aside class="project-sidebar">
        <section>
          <h3>Metadata</h3>
          <div class="sidebar-section"><strong>Source</strong><div>${escapeHtml(sourceName)}</div></div>
          ${initiative ? `<div class="sidebar-section"><strong>Initiative</strong><div><a href="/initiatives/${escapeAttr(sourceName)}/${escapeAttr(initiative.id)}">${escapeHtml(initiative.name)}</a></div></div>` : ""}
          ${dates}
          ${tags ? `<div class="sidebar-section"><strong>Tags</strong><div>${tags}</div></div>` : ""}
          ${p.client ? `<div class="sidebar-section"><strong>Client</strong><div>${escapeHtml(p.client)}</div></div>` : ""}
          ${relatedLinks ? `<div class="sidebar-section"><strong>Related</strong><div>${relatedLinks}</div></div>` : ""}
          ${p.outcome ? `<div class="sidebar-section"><strong>Outcome</strong><div>${escapeHtml(p.outcome)}</div></div>` : ""}
          ${p.superseded_by ? `<div class="sidebar-section"><strong>Superseded by</strong><div><a href="/projects/${encodeURIComponent(sourceName)}/${encodeURIComponent(p.superseded_by)}">${escapeHtml(p.superseded_by)}</a></div></div>` : ""}
        </section>
        ${p.key_result ? `<section><h3>Key Result</h3><p>${escapeHtml(p.key_result)}</p></section>` : ""}
        ${sessionsList}
      </aside>

      <div class="project-content">
        ${p.description ? `<section class="project-description"><p>${escapeHtml(p.description.replace(/\n/g, " "))}</p></section>` : ""}

        ${contextHtml ? `
          <section>
            <h2>Context (Working Memory)</h2>
            <div class="rendered-markdown">${contextHtml}</div>
          </section>
        ` : `<section><p><em>No CONTEXT.md file found for this project.</em></p></section>`}

        ${referenceHtml ? `
          <details open>
            <summary><h2 style="display:inline">Reference (Stable Facts)</h2></summary>
            <div class="rendered-markdown">${referenceHtml}</div>
          </details>
        ` : ""}
      </div>
    </div>
  `;
}

function buildDatesTable(p: Project): string {
  const rows: string[] = [];
  if (p.started_date) rows.push(`<tr><td>Started</td><td>${escapeHtml(p.started_date)}</td></tr>`);
  if (p.completed_date) rows.push(`<tr><td>Completed</td><td>${escapeHtml(p.completed_date)}</td></tr>`);
  if (p.archived_date) rows.push(`<tr><td>Archived</td><td>${escapeHtml(p.archived_date)}</td></tr>`);
  if (p.last_session) rows.push(`<tr><td>Last session</td><td>${escapeHtml(p.last_session)}</td></tr>`);

  if (rows.length === 0) return "";
  return `<table class="dates-table"><tbody>${rows.join("")}</tbody></table>`;
}

function renderSessionsList(
  projectId: string,
  sessions: { name: string; period: string }[],
  sourceName: string
): string {
  if (sessions.length === 0) return "";

  const items = sessions
    .map(
      (s) =>
        `<li><a href="/projects/${encodeURIComponent(sourceName)}/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(s.period)}">${escapeHtml(s.name)}</a></li>`
    )
    .join("\n");

  return `
    <section>
      <h3>Sessions</h3>
      <ul>${items}</ul>
    </section>
  `;
}
