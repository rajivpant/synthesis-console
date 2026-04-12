import { escapeHtml, escapeAttr } from "../utils.js";

export function sessionDetailView(opts: {
  projectId: string;
  projectName: string;
  period: string;
  contentHtml: string;
  workspace: string;
}): string {
  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/projects?ws=${escapeAttr(opts.workspace)}">Projects</a></li>
        <li><a href="/projects/${encodeURIComponent(opts.projectId)}?ws=${escapeAttr(opts.workspace)}">${escapeHtml(opts.projectName)}</a></li>
        <li>Session: ${escapeHtml(opts.period)}</li>
      </ul>
    </nav>

    <h1>${escapeHtml(opts.projectName)} — Session ${escapeHtml(opts.period)}</h1>

    <div class="rendered-markdown">
      ${opts.contentHtml}
    </div>
  `;
}
