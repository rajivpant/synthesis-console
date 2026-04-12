import type { WorkspaceConfig } from "../config.js";
import { escapeHtml, escapeAttr } from "../utils.js";
import pkg from "../../package.json";

export function layout(opts: {
  title: string;
  content: string;
  workspaces: WorkspaceConfig[];
  currentWorkspace: string;
  currentPath?: string;
  demoMode?: boolean;
}): string {
  const wsSelector =
    opts.workspaces.length > 1
      ? `<li>
          <select id="workspace-select" onchange="switchWorkspace(this.value)" aria-label="Workspace">
            ${opts.workspaces
              .map(
                (ws) =>
                  `<option value="${escapeAttr(ws.name)}"${ws.name === opts.currentWorkspace ? " selected" : ""}>${escapeHtml(ws.name)}</option>`
              )
              .join("\n")}
          </select>
        </li>`
      : "";

  const nav = buildNav(opts.currentPath || "", opts.currentWorkspace);
  const demoBadge = opts.demoMode
    ? '<span class="badge badge-demo">DEMO</span>'
    : "";

  return `<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(opts.title)} - Synthesis Console</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header class="container">
    <nav>
      <ul>
        <li><a href="/projects?ws=${escapeAttr(opts.currentWorkspace)}" class="logo"><strong>Synthesis Console</strong></a> ${demoBadge}</li>
      </ul>
      <ul>
        ${nav}
        ${wsSelector}
      </ul>
    </nav>
  </header>
  <main class="container">
    ${opts.content}
  </main>
  <footer class="container">
    <small>Synthesis Console v${pkg.version} — local-first project dashboard for synthesis engineering</small>
  </footer>
  <script>
    function switchWorkspace(ws) {
      const url = new URL(window.location);
      url.searchParams.set('ws', ws);
      window.location = url.toString();
    }
  </script>
</body>
</html>`;
}

function buildNav(currentPath: string, ws: string): string {
  const links = [
    { href: `/projects?ws=${ws}`, label: "Projects", match: "/projects" },
    { href: `/lessons?ws=${ws}`, label: "Lessons", match: "/lessons" },
  ];

  return links
    .map((link) => {
      const active = currentPath.startsWith(link.match) ? ' class="active"' : "";
      return `<li><a href="${link.href}"${active}>${link.label}</a></li>`;
    })
    .join("\n");
}
