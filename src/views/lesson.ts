import { escapeHtml, escapeAttr } from "../utils.js";

export interface LessonEntry {
  slug: string;
  filename: string;
  date: string;
  title: string;
}

export function lessonListView(opts: {
  lessons: LessonEntry[];
  workspace: string;
}): string {
  const { lessons, workspace } = opts;

  if (lessons.length === 0) {
    return `<h1>Lessons</h1><p>No lessons found.</p>`;
  }

  const rows = lessons
    .map(
      (l) => `
      <tr>
        <td><time>${escapeHtml(l.date)}</time></td>
        <td><a href="/lessons/${encodeURIComponent(l.slug)}?ws=${escapeAttr(workspace)}">${escapeHtml(l.title)}</a></td>
      </tr>`
    )
    .join("\n");

  return `
    <h1>Lessons <small>(${lessons.length})</small></h1>
    <p>Cross-project lessons learned, sorted by date (most recent first).</p>
    <table>
      <thead>
        <tr><th>Date</th><th>Lesson</th></tr>
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
  workspace: string;
}): string {
  return `
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/lessons?ws=${escapeAttr(opts.workspace)}">Lessons</a></li>
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
