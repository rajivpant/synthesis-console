import { escapeHtml, escapeAttr } from "../utils.js";

export function sessionDetailView(opts: {
  projectId: string;
  projectName: string;
  period: string;
  contentHtml: string;
  sourceName: string;
}): string {
  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/projects">Projects</a></li>
        <li><a href="/projects/${encodeURIComponent(opts.sourceName)}/${encodeURIComponent(opts.projectId)}">${escapeHtml(opts.projectName)}</a></li>
        <li>Session: ${escapeHtml(opts.period)}</li>
      </ul>
    </nav>

    <h1>${escapeHtml(opts.projectName)} — Session ${escapeHtml(opts.period)}</h1>
    <p><small>Source: <span class="source-badge" title="Source: ${escapeAttr(opts.sourceName)}">${escapeHtml(opts.sourceName)}</span></small></p>

    <div class="rendered-markdown">
      ${opts.contentHtml}
    </div>
  `;
}
