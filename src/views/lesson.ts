import type { Source } from "../config.js";
import { escapeHtml, escapeAttr } from "../utils.js";

export interface LessonEntry {
  slug: string;
  filename: string;
  date: string;
  title: string;
  source: string;
}

export function lessonListView(opts: {
  lessons: LessonEntry[];
  sources: Source[];
}): string {
  const { lessons, sources } = opts;

  if (lessons.length === 0) {
    return `<h1>Lessons</h1><p>No lessons found in the selected sources.</p>`;
  }

  const sourceByName = new Map(sources.map((s) => [s.name, s]));
  const showSource = sources.length > 1;

  const rows = lessons
    .map((l) => {
      const src = sourceByName.get(l.source);
      const sourceLabel = src ? escapeHtml(src.display_name || src.name) : escapeHtml(l.source);
      const sourceCell = showSource
        ? `<td><span class="source-badge" title="Source: ${escapeAttr(l.source)}">${sourceLabel}</span></td>`
        : "";
      return `
        <tr>
          <td><time>${escapeHtml(l.date)}</time></td>
          <td><a href="/lessons/${encodeURIComponent(l.source)}/${encodeURIComponent(l.slug)}">${escapeHtml(l.title)}</a></td>
          ${sourceCell}
        </tr>`;
    })
    .join("\n");

  const sourceColHeader = showSource ? "<th>Source</th>" : "";

  return `
    <h1>Lessons <small>(${lessons.length})</small></h1>
    <p>Cross-project lessons learned, sorted by date (most recent first).</p>
    <table class="lessons-table">
      <thead>
        <tr><th>Date</th><th>Lesson</th>${sourceColHeader}</tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

export function lessonDetailView(opts: {
  lesson: LessonEntry;
  contentHtml: string;
}): string {
  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/lessons">Lessons</a></li>
        <li><span class="source-badge" title="Source: ${escapeAttr(opts.lesson.source)}">${escapeHtml(opts.lesson.source)}</span></li>
        <li>${escapeHtml(opts.lesson.title)}</li>
      </ul>
    </nav>

    <hgroup>
      <h1>${escapeHtml(opts.lesson.title)}</h1>
      <p><time>${escapeHtml(opts.lesson.date)}</time></p>
    </hgroup>

    <div class="rendered-markdown">
      ${opts.contentHtml}
    </div>
  `;
}
