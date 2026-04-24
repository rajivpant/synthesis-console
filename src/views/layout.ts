import type { Source } from "../config.js";
import { escapeHtml, escapeAttr } from "../utils.js";
import { SOURCES_COOKIE } from "../active-sources.js";
import pkg from "../../package.json";

export function layout(opts: {
  title: string;
  content: string;
  sources: Source[];
  activeSourceNames: string[];
  currentPath?: string;
  demoMode: boolean;
}): string {
  const visibleSources = opts.demoMode
    ? opts.sources.filter((s) => s.demo === true)
    : opts.sources;

  const isDemoActive =
    opts.demoMode ||
    opts.activeSourceNames.some((n) => opts.sources.find((s) => s.name === n)?.demo === true);

  const demoBadge = isDemoActive ? '<span class="badge badge-demo">DEMO</span>' : "";
  const nav = buildNav(opts.currentPath || "");
  const picker = buildSourcePicker(visibleSources, opts.activeSourceNames, opts.demoMode);

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
        <li><a href="/projects" class="logo"><strong>Synthesis Console</strong></a> ${demoBadge}</li>
      </ul>
      <ul>
        ${nav}
        ${picker}
      </ul>
    </nav>
  </header>
  <main class="container">
    ${opts.content}
  </main>
  <footer class="container">
    <small>Synthesis Console v${pkg.version} — local-first tooling for synthesis engineering</small>
  </footer>
  <script>${layoutScript()}</script>
</body>
</html>`;
}

function buildNav(currentPath: string): string {
  const links = [
    { href: "/initiatives", label: "Initiatives", match: "/initiatives" },
    { href: "/projects", label: "Projects", match: "/projects" },
    { href: "/plans", label: "Plans", match: "/plans" },
    { href: "/lessons", label: "Lessons", match: "/lessons" },
  ];

  return links
    .map((link) => {
      const active = currentPath.startsWith(link.match) ? ' class="active"' : "";
      return `<li><a href="${link.href}"${active}>${link.label}</a></li>`;
    })
    .join("\n");
}

function buildSourcePicker(
  sources: Source[],
  activeNames: string[],
  demoMode: boolean
): string {
  if (sources.length <= 1) return "";

  const activeSet = new Set(activeNames);
  const activeCount = sources.filter((s) => activeSet.has(s.name)).length;
  const summary =
    activeCount === sources.length
      ? "All sources"
      : activeCount === 0
        ? "No sources"
        : activeCount === 1
          ? sources.find((s) => activeSet.has(s.name))?.display_name ||
            sources.find((s) => activeSet.has(s.name))?.name ||
            "1 source"
          : `${activeCount} sources`;

  const disabled = demoMode ? " disabled" : "";
  const hint = demoMode
    ? `<p><small>Demo mode is active; source selection is disabled.</small></p>`
    : "";

  const items = sources
    .map((s) => {
      const checked = activeSet.has(s.name) ? " checked" : "";
      const label = escapeHtml(s.display_name || s.name);
      const demoLabel = s.demo
        ? ' <span class="badge badge-demo" style="font-size:0.7em">demo</span>'
        : "";
      return `<li>
        <label>
          <input type="checkbox" name="source" value="${escapeAttr(s.name)}"${checked}${disabled}>
          ${label}${demoLabel}
        </label>
      </li>`;
    })
    .join("\n");

  return `<li>
    <details class="source-picker" role="list">
      <summary aria-haspopup="listbox">${escapeHtml(summary)}</summary>
      <ul role="listbox" aria-label="Active sources">
        ${items}
      </ul>
      ${hint}
    </details>
  </li>`;
}

function layoutScript(): string {
  return `
    (function() {
      const COOKIE = ${JSON.stringify(SOURCES_COOKIE)};

      function setCookie(value) {
        // Cookie lasts 1 year. Local-only tool; no Secure/HttpOnly needed.
        document.cookie = COOKIE + '=' + encodeURIComponent(value) + '; path=/; max-age=31536000; samesite=lax';
      }

      function currentSelection() {
        return Array.from(document.querySelectorAll('input[type=checkbox][name=source]'))
          .filter(cb => cb.checked)
          .map(cb => cb.value);
      }

      const picker = document.querySelector('.source-picker');
      if (picker) {
        picker.addEventListener('change', function(e) {
          if (e.target && e.target.name === 'source') {
            const names = currentSelection();
            setCookie(names.join(','));
            try { localStorage.setItem(COOKIE, names.join(',')); } catch (_) {}
            // Reload to re-fetch content for the new selection.
            const url = new URL(window.location.href);
            url.searchParams.delete('sources');
            window.location.href = url.toString();
          }
        });
      }

      // On first visit with nothing checked but localStorage populated, sync cookie and reload.
      try {
        if (!document.cookie.split('; ').some(c => c.startsWith(COOKIE + '='))) {
          const cached = localStorage.getItem(COOKIE);
          if (cached) {
            setCookie(cached);
            window.location.reload();
          }
        }
      } catch (_) {}

      function getDraftText(actionsEl) {
        var prev = actionsEl.previousElementSibling;
        if (!prev) return '';
        var raw = prev.innerText || prev.textContent || '';
        return raw.replace(/\\u00A0/g, ' ').trim();
      }

      function flashCopied(button) {
        var original = button.textContent;
        button.textContent = 'Copied';
        button.classList.add('draft-copied');
        setTimeout(function () {
          button.textContent = original;
          button.classList.remove('draft-copied');
        }, 1500);
      }

      function copyText(text, button) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            flashCopied(button);
          }).catch(function () {
            fallbackCopy(text, button);
          });
        } else {
          fallbackCopy(text, button);
        }
      }

      function fallbackCopy(text, button) {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          flashCopied(button);
        } catch (_) {}
        document.body.removeChild(ta);
      }

      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        var copyBtn = t.closest('.draft-copy');
        if (copyBtn) {
          e.preventDefault();
          var actions = copyBtn.closest('.draft-actions');
          if (actions) {
            var text = getDraftText(actions);
            if (text) copyText(text, copyBtn);
          }
          return;
        }

        var emailLink = t.closest('.draft-email');
        if (emailLink) {
          e.preventDefault();
          var actions2 = emailLink.closest('.draft-actions');
          var body = actions2 ? getDraftText(actions2) : '';
          var email = emailLink.dataset.email || '';
          var subject = emailLink.dataset.subject || '';
          var url = 'mailto:' + email;
          var qs = [];
          if (subject) qs.push('subject=' + encodeURIComponent(subject));
          if (body) qs.push('body=' + encodeURIComponent(body));
          if (qs.length) url += '?' + qs.join('&');
          window.location.href = url;
        }
      });
    })();
  `;
}
