import type { Source } from "../config.js";
import type { InitiativeWithSource, ProjectWithSource, ProjectStatus } from "../parsers/yaml.js";
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

export function initiativeListView(opts: {
  initiatives: InitiativeWithSource[];
  projects: ProjectWithSource[];
  sources: Source[];
}): string {
  const { initiatives, projects, sources } = opts;

  // Group initiatives by source; within each source, sort by status (active first) then by name.
  const sourceByName = new Map(sources.map((s) => [s.name, s]));
  const showSourceHeader = sources.length > 1;

  const bySource = new Map<string, InitiativeWithSource[]>();
  for (const i of initiatives) {
    if (!bySource.has(i._source)) bySource.set(i._source, []);
    bySource.get(i._source)!.push(i);
  }

  for (const [, list] of bySource) {
    list.sort((a, b) => {
      const statusRank = (s: string) => (s === "active" ? 0 : s === "ongoing" ? 1 : s === "paused" ? 2 : s === "new" ? 3 : 4);
      const d = statusRank(a.status) - statusRank(b.status);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
  }

  // Count member projects and ungrouped projects per source.
  const memberCountByInitiative = new Map<string, number>();
  const ungroupedBySource = new Map<string, number>();
  for (const p of projects) {
    if (p.initiative) {
      const key = `${p._source}:${p.initiative}`;
      memberCountByInitiative.set(key, (memberCountByInitiative.get(key) || 0) + 1);
    } else {
      ungroupedBySource.set(p._source, (ungroupedBySource.get(p._source) || 0) + 1);
    }
  }

  const totalInitiatives = initiatives.length;

  if (totalInitiatives === 0) {
    const ungroupedTotal = [...ungroupedBySource.values()].reduce((a, b) => a + b, 0);
    return `
      <h1>Initiatives</h1>
      <p>No initiatives declared in the selected sources.</p>
      <p><small>Add an <code>initiatives:</code> section to a source's <code>projects/index.yaml</code> to group projects into portfolio-level units. See <a href="https://github.com/synthesisengineering/synthesis-console/blob/main/docs/layouts.md">docs/layouts.md</a>.</small></p>
      ${ungroupedTotal > 0 ? `<p><small>${ungroupedTotal} project${ungroupedTotal === 1 ? " is" : "s are"} currently ungrouped.</small></p>` : ""}
    `;
  }

  const sections: string[] = [];

  for (const src of sources) {
    const list = bySource.get(src.name);
    if (!list || list.length === 0) continue;

    const sourceLabel = src.display_name || src.name;
    const ungrouped = ungroupedBySource.get(src.name) || 0;

    const header = showSourceHeader
      ? `<h2><span class="source-badge">${escapeHtml(sourceLabel)}</span></h2>`
      : "";

    const cards = list.map((i) => renderCard(i, memberCountByInitiative.get(`${i._source}:${i.id}`) || 0)).join("\n");

    const ungroupedCard =
      ungrouped > 0
        ? `<article class="initiative-card initiative-card-ungrouped">
            <header>
              <h3><a href="/projects?source=${escapeAttr(src.name)}&amp;initiative=_ungrouped">Ungrouped</a></h3>
              <span class="badge badge-outline">${ungrouped} project${ungrouped === 1 ? "" : "s"}</span>
            </header>
            <p><small>Projects in this source that are not yet assigned to an initiative.</small></p>
          </article>`
        : "";

    sections.push(`
      <section class="initiative-source-section">
        ${header}
        <div class="initiative-grid">
          ${cards}
          ${ungroupedCard}
        </div>
      </section>
    `);
  }

  return `
    <h1>Initiatives <small>(${totalInitiatives})</small></h1>
    <p>Portfolio-level view across active sources. Each initiative groups a set of related projects.</p>
    ${sections.join("\n")}
  `;
}

function renderCard(initiative: InitiativeWithSource, memberCount: number): string {
  const statusColor = STATUS_COLORS[initiative.status] || "gray";
  const description = initiative.description
    ? `<p class="initiative-desc">${escapeHtml(truncate(initiative.description, 180))}</p>`
    : "";

  const metaParts: string[] = [];
  if (initiative.lead) metaParts.push(`Lead: ${escapeHtml(initiative.lead)}`);
  if (initiative.stakeholder) metaParts.push(`Stakeholder: ${escapeHtml(initiative.stakeholder)}`);
  const meta = metaParts.length ? `<p class="initiative-meta"><small>${metaParts.join(" &middot; ")}</small></p>` : "";

  const dateParts: string[] = [];
  if (initiative.started_date) dateParts.push(`Started ${escapeHtml(initiative.started_date)}`);
  if (initiative.target_date) dateParts.push(`Target ${escapeHtml(initiative.target_date)}`);
  if (initiative.completed_date) dateParts.push(`Completed ${escapeHtml(initiative.completed_date)}`);
  const dates = dateParts.length ? `<p class="initiative-dates"><small>${dateParts.join(" &middot; ")}</small></p>` : "";

  return `
    <article class="initiative-card">
      <header>
        <h3>
          <a href="/initiatives/${encodeURIComponent(initiative._source)}/${encodeURIComponent(initiative.id)}">
            ${escapeHtml(initiative.name)}
          </a>
        </h3>
        <div>
          <span class="badge badge-${statusColor}">${escapeHtml(initiative.status)}</span>
          <span class="badge badge-outline">${memberCount} project${memberCount === 1 ? "" : "s"}</span>
        </div>
      </header>
      ${description}
      ${meta}
      ${dates}
    </article>
  `;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).trimEnd() + "...";
}
