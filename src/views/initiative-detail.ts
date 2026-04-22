import type { Initiative, ProjectStatus, ProjectWithSource } from "../parsers/yaml.js";
import { escapeHtml, escapeAttr } from "../utils.js";

const STATUS_COLORS: Record<ProjectStatus, string> = {
  active: "blue",
  new: "purple",
  paused: "yellow",
  ongoing: "teal",
  completed: "green",
  archived: "gray",
  superseded: "red",
};

const STATUS_ORDER: ProjectStatus[] = [
  "active",
  "new",
  "paused",
  "ongoing",
  "completed",
  "archived",
  "superseded",
];

export function initiativeDetailView(opts: {
  initiative: Initiative;
  memberProjects: ProjectWithSource[];
  recentSessions: { projectId: string; projectName: string; period: string; sourceName: string }[];
  sourceName: string;
}): string {
  const { initiative: i, memberProjects, recentSessions, sourceName } = opts;
  const statusColor = STATUS_COLORS[i.status] || "gray";

  const tags = (i.tags || [])
    .map((t) => `<a href="/projects?tag=${encodeURIComponent(t)}" class="tag">${escapeHtml(t)}</a>`)
    .join(" ");

  const relatedLinks = (i.related || [])
    .map(
      (r) =>
        `<a href="/initiatives/${encodeURIComponent(sourceName)}/${encodeURIComponent(r)}">${escapeHtml(r)}</a>`
    )
    .join(", ");

  const externalLinks = i.links
    ? Object.entries(i.links)
        .map(([k, v]) => `<li><strong>${escapeHtml(k)}:</strong> <a href="${escapeAttr(v)}">${escapeHtml(v)}</a></li>`)
        .join("")
    : "";

  const metaRows: string[] = [];
  if (i.lead) metaRows.push(`<tr><td>Lead</td><td>${escapeHtml(i.lead)}</td></tr>`);
  if (i.stakeholder) metaRows.push(`<tr><td>Stakeholder</td><td>${escapeHtml(i.stakeholder)}</td></tr>`);
  if (i.started_date) metaRows.push(`<tr><td>Started</td><td>${escapeHtml(i.started_date)}</td></tr>`);
  if (i.target_date) metaRows.push(`<tr><td>Target</td><td>${escapeHtml(i.target_date)}</td></tr>`);
  if (i.completed_date) metaRows.push(`<tr><td>Completed</td><td>${escapeHtml(i.completed_date)}</td></tr>`);

  const statusCounts: Record<string, number> = {};
  for (const p of memberProjects) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }
  const statusBadges = STATUS_ORDER.filter((s) => statusCounts[s])
    .map((s) => `<span class="badge badge-${STATUS_COLORS[s]}">${statusCounts[s]} ${s}</span>`)
    .join(" ");

  const projectGroups = groupProjectsByStatus(memberProjects);
  const projectsHtml = renderProjectGroups(projectGroups);

  const sessionsHtml = renderRecentSessions(recentSessions);

  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/initiatives">Initiatives</a></li>
        <li><span class="source-badge" title="Source: ${escapeAttr(sourceName)}">${escapeHtml(sourceName)}</span></li>
        <li>${escapeHtml(i.name)}</li>
      </ul>
    </nav>

    <hgroup>
      <h1>${escapeHtml(i.name)}</h1>
      <p>
        <span class="badge badge-${statusColor}">${escapeHtml(i.status)}</span>
        <span class="badge badge-outline">${memberProjects.length} project${memberProjects.length === 1 ? "" : "s"}</span>
      </p>
    </hgroup>

    <div class="initiative-detail-layout">
      <aside class="initiative-sidebar">
        ${metaRows.length ? `<section><h3>Metadata</h3><table class="dates-table"><tbody>${metaRows.join("")}</tbody></table></section>` : ""}
        ${tags ? `<section><h3>Tags</h3><div>${tags}</div></section>` : ""}
        ${relatedLinks ? `<section><h3>Related initiatives</h3><p>${relatedLinks}</p></section>` : ""}
        ${externalLinks ? `<section><h3>Links</h3><ul class="sidebar-links">${externalLinks}</ul></section>` : ""}
      </aside>

      <div class="initiative-content">
        ${i.description ? `<section class="initiative-description"><p>${escapeHtml(i.description)}</p></section>` : ""}

        <section>
          <h2>Status rollup</h2>
          <div class="stats-bar">${statusBadges || '<span class="badge badge-outline">no projects yet</span>'}</div>
        </section>

        <section>
          <h2>Member projects</h2>
          ${memberProjects.length === 0 ? `<p><em>No projects assigned to this initiative yet. Add <code>initiative: ${escapeHtml(i.id)}</code> to a project entry in <code>projects/index.yaml</code>.</em></p>` : projectsHtml}
        </section>

        ${sessionsHtml}
      </div>
    </div>
  `;
}

function groupProjectsByStatus(projects: ProjectWithSource[]): Map<ProjectStatus, ProjectWithSource[]> {
  const grouped = new Map<ProjectStatus, ProjectWithSource[]>();
  for (const p of projects) {
    const status = p.status as ProjectStatus;
    if (!grouped.has(status)) grouped.set(status, []);
    grouped.get(status)!.push(p);
  }
  for (const [, list] of grouped) {
    list.sort((a, b) => {
      const dateA = a.last_session || a.started_date || "";
      const dateB = b.last_session || b.started_date || "";
      return dateB.localeCompare(dateA);
    });
  }
  return grouped;
}

function renderProjectGroups(grouped: Map<ProjectStatus, ProjectWithSource[]>): string {
  const sections: string[] = [];
  for (const status of STATUS_ORDER) {
    const list = grouped.get(status);
    if (!list || list.length === 0) continue;
    const rows = list.map(renderProjectRow).join("\n");
    sections.push(`
      <div class="project-group">
        <h3><span class="badge badge-${STATUS_COLORS[status]}">${status}</span> <small>(${list.length})</small></h3>
        <div class="project-table" role="grid">${rows}</div>
      </div>
    `);
  }
  return sections.join("\n");
}

function renderProjectRow(p: ProjectWithSource): string {
  const date = p.last_session || p.completed_date || p.started_date || "";
  const description = p.description
    ? `<p class="project-desc">${escapeHtml(truncate(p.description.replace(/\n/g, " "), 140))}</p>`
    : "";
  return `
    <article class="project-row">
      <div class="project-header">
        <a href="/projects/${encodeURIComponent(p._source)}/${encodeURIComponent(p.id)}">
          <strong>${escapeHtml(p.name)}</strong>
        </a>
        ${date ? `<time>${escapeHtml(date)}</time>` : ""}
      </div>
      ${description}
    </article>
  `;
}

function renderRecentSessions(
  sessions: { projectId: string; projectName: string; period: string; sourceName: string }[]
): string {
  if (sessions.length === 0) return "";
  const items = sessions
    .map(
      (s) => `
        <li>
          <time>${escapeHtml(s.period)}</time> —
          <a href="/projects/${encodeURIComponent(s.sourceName)}/${encodeURIComponent(s.projectId)}/sessions/${encodeURIComponent(s.period)}">
            ${escapeHtml(s.projectName)}
          </a>
        </li>`
    )
    .join("");
  return `
    <section>
      <h2>Recent session activity</h2>
      <ul class="initiative-sessions">${items}</ul>
    </section>
  `;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "...";
}
