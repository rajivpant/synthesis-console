import type { ProjectStatus, ProjectWithSource } from "../parsers/yaml.js";
import type { Source } from "../config.js";
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
  projects: ProjectWithSource[];
  allTags: Map<string, number>;
  currentFilters: { status?: string; tag?: string; client?: string; q?: string; source?: string };
  sources: Source[];
  activeSourceNames: string[];
  demoMode: boolean;
}): string {
  const { projects, allTags, currentFilters, sources, activeSourceNames, demoMode } = opts;
  const isDemoActive =
    demoMode ||
    activeSourceNames.some((n) => sources.find((s) => s.name === n)?.demo === true);

  const statusCounts: Record<string, number> = {};
  for (const p of projects) {
    statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;
  }

  const grouped = new Map<ProjectStatus, ProjectWithSource[]>();
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

  const demoBanner = isDemoActive
    ? `<div class="demo-banner" role="status">
        You're viewing demo data with sample projects. This data illustrates the conventions that Synthesis Console renders.
        <a href="https://github.com/rajivpant/synthesis-console">Learn more</a>
      </div>`
    : "";

  const activeCount = activeSourceNames.length;
  const emptyMessage =
    activeCount === 0
      ? `<p>No sources selected. Use the picker in the header to choose which sources to view.</p>`
      : projects.length === 0
        ? `<p>No projects found in ${activeCount === 1 ? "the selected source" : "the selected sources"}. ${sources.length > activeCount ? "Try selecting more sources." : ""}</p>`
        : "";

  const statsHtml = renderStats(statusCounts, projects.length);
  const filtersHtml = renderFilters(currentFilters, allTags, sources, activeSourceNames);
  const projectsHtml = emptyMessage || renderProjectGroups(grouped, sources);

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
  current: { status?: string; tag?: string; client?: string; q?: string; source?: string },
  allTags: Map<string, number>,
  sources: Source[],
  activeSourceNames: string[]
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

  const activeSet = new Set(activeSourceNames);
  const sourceFilterCurrent = current.source?.split(",") || [];
  const sourceButtons = sources
    .filter((s) => activeSet.has(s.name))
    .map((s) => {
      const active = sourceFilterCurrent.includes(s.name);
      const label = escapeHtml(s.display_name || s.name);
      return `<button class="source-toggle${active ? " active" : ""}" data-source="${escapeAttr(s.name)}">${label}</button>`;
    })
    .join("\n");

  const sourceFilter =
    activeSet.size > 1
      ? `<details>
          <summary>Source <small>(filter within selected)</small></summary>
          <div class="filter-group">${sourceButtons}</div>
        </details>`
      : "";

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
      ${sourceFilter}
      <details>
        <summary>Tags <small>(${allTags.size} total)</small></summary>
        <div class="filter-group">${tagButtons}</div>
      </details>
    </div>
    <script>
      (function() {
        let searchTimeout;
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
          searchInput.addEventListener('input', function(e) {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => updateFilter('q', e.target.value), 300);
          });
        }

        function bindToggle(selector, paramName, attrName) {
          document.querySelectorAll(selector).forEach(btn => {
            btn.addEventListener('click', () => {
              const value = btn.dataset[attrName];
              const url = new URL(window.location);
              const curr = url.searchParams.get(paramName);
              const list = curr ? curr.split(',') : [];
              const idx = list.indexOf(value);
              if (idx >= 0) list.splice(idx, 1);
              else list.push(value);
              if (list.length) url.searchParams.set(paramName, list.join(','));
              else url.searchParams.delete(paramName);
              window.location = url.toString();
            });
          });
        }

        bindToggle('.status-toggle', 'status', 'status');
        bindToggle('.tag-toggle', 'tag', 'tag');
        bindToggle('.source-toggle', 'source', 'source');

        function updateFilter(key, value) {
          const url = new URL(window.location);
          if (value) url.searchParams.set(key, value);
          else url.searchParams.delete(key);
          window.location = url.toString();
        }
      })();
    </script>
  `;
}

function renderProjectGroups(
  grouped: Map<ProjectStatus, ProjectWithSource[]>,
  sources: Source[]
): string {
  const sections: string[] = [];
  const sourceByName = new Map(sources.map((s) => [s.name, s]));

  for (const status of STATUS_ORDER) {
    const projects = grouped.get(status);
    if (!projects || projects.length === 0) continue;

    const rows = projects.map((p) => renderProjectRow(p, sourceByName)).join("\n");

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

function renderProjectRow(p: ProjectWithSource, sourceByName: Map<string, Source>): string {
  const src = sourceByName.get(p._source);
  const sourceLabel = src ? escapeHtml(src.display_name || src.name) : escapeHtml(p._source);

  const tags = (p.tags || [])
    .map(
      (t) =>
        `<a href="/projects?tag=${encodeURIComponent(t)}" class="tag">${escapeHtml(t)}</a>`
    )
    .join(" ");

  const date = p.last_session || p.completed_date || p.started_date || "";

  const description = p.description
    ? truncate(p.description.replace(/\n/g, " "), 160)
    : "";

  return `
    <article class="project-row">
      <div class="project-header">
        <a href="/projects/${encodeURIComponent(p._source)}/${encodeURIComponent(p.id)}">
          <strong>${escapeHtml(p.name)}</strong>
        </a>
        ${date ? `<time>${escapeHtml(date)}</time>` : ""}
      </div>
      ${description ? `<p class="project-desc">${escapeHtml(description)}</p>` : ""}
      <div class="project-meta">
        <span class="source-badge" title="Source: ${escapeAttr(p._source)}">${sourceLabel}</span>
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
