import type { Project, ProjectStatus } from "../parsers/yaml.js";
import { escapeHtml, escapeAttr } from "../utils.js";

const STATUS_ORDER: ProjectStatus[] = [
  "active",
  "new",
  "paused",
  "ongoing",
  "completed",
  "archived",
  "superseded",
];

const STATUS_COLORS: Record<ProjectStatus, string> = {
  active: "blue",
  new: "purple",
  paused: "yellow",
  ongoing: "teal",
  completed: "green",
  archived: "gray",
  superseded: "red",
};

export function projectListView(opts: {
  projects: Project[];
  allTags: Map<string, number>;
  currentFilters: { status?: string; tag?: string; client?: string; q?: string };
  workspace: string;
  demoMode?: boolean;
}): string {
  const { projects, allTags, currentFilters, workspace, demoMode } = opts;

  const statusCounts: Record<string, number> = {};
  for (const p of projects) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }

  const grouped = new Map<ProjectStatus, Project[]>();
  for (const p of projects) {
    const status = p.status as ProjectStatus;
    if (!grouped.has(status)) grouped.set(status, []);
    grouped.get(status)!.push(p);
  }

  for (const [, group] of grouped) {
    group.sort((a, b) => {
      const dateA = a.last_session || a.started_date || "";
      const dateB = b.last_session || b.started_date || "";
      return dateB.localeCompare(dateA);
    });
  }

  const demoBanner = demoMode
    ? `<div class="demo-banner" role="status">
        You're viewing a demo workspace with sample projects. This data illustrates the conventions that Synthesis Console renders.
        <a href="https://github.com/rajivpant/synthesis-console">Learn more</a>
      </div>`
    : "";

  const statsHtml = renderStats(statusCounts, projects.length);
  const filtersHtml = renderFilters(currentFilters, allTags, workspace);
  const projectsHtml = renderProjectGroups(grouped, workspace);

  return `
    <h1>Projects</h1>
    ${demoBanner}
    ${statsHtml}
    ${filtersHtml}
    ${projectsHtml}
  `;
}

function renderStats(
  statusCounts: Record<string, number>,
  total: number
): string {
  const badges = STATUS_ORDER.filter((s) => statusCounts[s])
    .map(
      (s) =>
        `<span class="badge badge-${STATUS_COLORS[s]}">${statusCounts[s]} ${s}</span>`
    )
    .join(" ");

  return `<div class="stats-bar">${badges} <span class="badge badge-outline">${total} total</span></div>`;
}

function renderFilters(
  current: { status?: string; tag?: string; client?: string; q?: string },
  allTags: Map<string, number>,
  workspace: string
): string {
  const statusToggles = STATUS_ORDER.map((s) => {
    const active = current.status?.split(",").includes(s);
    return `<button class="status-toggle${active ? " active" : ""}" data-status="${s}">${s}</button>`;
  }).join("\n");

  const topTags = [...allTags.entries()].slice(0, 20);
  const tagButtons = topTags
    .map(([tag, count]) => {
      const active = current.tag?.split(",").includes(tag);
      return `<button class="tag-toggle${active ? " active" : ""}" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)} <small>(${count})</small></button>`;
    })
    .join("\n");

  return `
    <div class="filters">
      <div class="search-bar">
        <input type="search" id="search-input" placeholder="Search projects..."
               value="${escapeAttr(current.q || "")}"
               aria-label="Search projects">
      </div>
      <details open>
        <summary>Status</summary>
        <div class="filter-group">${statusToggles}</div>
      </details>
      <details>
        <summary>Tags <small>(${allTags.size} total)</small></summary>
        <div class="filter-group">${tagButtons}</div>
      </details>
    </div>
    <script>
      const ws = ${JSON.stringify(workspace)};

      let searchTimeout;
      document.getElementById('search-input').addEventListener('input', function(e) {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => updateFilter('q', e.target.value), 300);
      });

      document.querySelectorAll('.status-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const status = btn.dataset.status;
          const url = new URL(window.location);
          const current = url.searchParams.get('status');
          const statuses = current ? current.split(',') : [];
          const idx = statuses.indexOf(status);
          if (idx >= 0) statuses.splice(idx, 1);
          else statuses.push(status);
          if (statuses.length) url.searchParams.set('status', statuses.join(','));
          else url.searchParams.delete('status');
          url.searchParams.set('ws', ws);
          window.location = url.toString();
        });
      });

      document.querySelectorAll('.tag-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
          const tag = btn.dataset.tag;
          const url = new URL(window.location);
          const current = url.searchParams.get('tag');
          const tags = current ? current.split(',') : [];
          const idx = tags.indexOf(tag);
          if (idx >= 0) tags.splice(idx, 1);
          else tags.push(tag);
          if (tags.length) url.searchParams.set('tag', tags.join(','));
          else url.searchParams.delete('tag');
          url.searchParams.set('ws', ws);
          window.location = url.toString();
        });
      });

      function updateFilter(key, value) {
        const url = new URL(window.location);
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
        url.searchParams.set('ws', ws);
        window.location = url.toString();
      }
    </script>
  `;
}

function renderProjectGroups(
  grouped: Map<ProjectStatus, Project[]>,
  workspace: string
): string {
  const sections: string[] = [];

  for (const status of STATUS_ORDER) {
    const projects = grouped.get(status);
    if (!projects || projects.length === 0) continue;

    const rows = projects.map((p) => renderProjectRow(p, workspace)).join("\n");

    sections.push(`
      <section class="project-group">
        <h2><span class="badge badge-${STATUS_COLORS[status]}">${status}</span> <small>(${projects.length})</small></h2>
        <div class="project-table" role="grid">
          ${rows}
        </div>
      </section>
    `);
  }

  if (sections.length === 0) {
    return `<p>No projects match the current filters.</p>`;
  }

  return sections.join("\n");
}

function renderProjectRow(p: Project, workspace: string): string {
  const tags = (p.tags || [])
    .map(
      (t) =>
        `<a href="/projects?ws=${escapeAttr(workspace)}&tag=${encodeURIComponent(t)}" class="tag">${escapeHtml(t)}</a>`
    )
    .join(" ");

  const date = p.last_session || p.completed_date || p.started_date || "";

  const description = p.description
    ? truncate(p.description.replace(/\n/g, " "), 160)
    : "";

  return `
    <article class="project-row">
      <div class="project-header">
        <a href="/projects/${encodeURIComponent(p.id)}?ws=${escapeAttr(workspace)}">
          <strong>${escapeHtml(p.name)}</strong>
        </a>
        ${date ? `<time>${escapeHtml(date)}</time>` : ""}
      </div>
      ${description ? `<p class="project-desc">${escapeHtml(description)}</p>` : ""}
      <div class="project-meta">
        ${tags}
        ${p.client ? `<span class="tag tag-client">${escapeHtml(p.client)}</span>` : ""}
      </div>
    </article>
  `;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "...";
}
