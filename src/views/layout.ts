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

      function findMessageEl(actionsEl) {
        // The message is the nearest preceding pre or blockquote sibling
        // (skip an existing textarea inserted in edit mode).
        var node = actionsEl.previousElementSibling;
        while (node) {
          var tag = node.tagName;
          if (tag === 'PRE' || tag === 'BLOCKQUOTE') return node;
          node = node.previousElementSibling;
        }
        return null;
      }

      function findEditTextarea(actionsEl) {
        var node = actionsEl.previousElementSibling;
        while (node) {
          if (node.tagName === 'TEXTAREA' && node.classList.contains('draft-textarea')) return node;
          if (node.tagName === 'PRE' || node.tagName === 'BLOCKQUOTE') return null;
          node = node.previousElementSibling;
        }
        return null;
      }

      function setStatus(actionsEl, msg, isError) {
        var statusEl = actionsEl.querySelector('.draft-status');
        if (!statusEl) return;
        statusEl.textContent = msg || '';
        statusEl.classList.toggle('draft-status-error', !!isError);
      }

      function enterEditMode(actionsEl) {
        if (actionsEl.dataset.mode === 'editing') return;
        var original = actionsEl.dataset.originalText || '';
        var messageEl = findMessageEl(actionsEl);
        if (!messageEl) return;

        var existing = findEditTextarea(actionsEl);
        var textarea = existing;
        if (!textarea) {
          textarea = document.createElement('textarea');
          textarea.className = 'draft-textarea';
          textarea.value = original;
          textarea.spellcheck = true;
          var lineCount = original.split('\\n').length;
          textarea.rows = Math.max(5, Math.min(40, lineCount + 2));
          actionsEl.parentNode.insertBefore(textarea, actionsEl);
        }
        messageEl.style.display = 'none';
        actionsEl.dataset.mode = 'editing';
        setStatus(actionsEl, '', false);
        textarea.focus();
        // Place cursor at the end so the user can keep typing.
        var len = textarea.value.length;
        try { textarea.setSelectionRange(len, len); } catch (_) {}
      }

      function exitEditMode(actionsEl) {
        var textarea = findEditTextarea(actionsEl);
        if (textarea && textarea.parentNode) textarea.parentNode.removeChild(textarea);
        var messageEl = findMessageEl(actionsEl);
        if (messageEl) messageEl.style.display = '';
        actionsEl.dataset.mode = '';
        setStatus(actionsEl, '', false);
      }

      function planUrlBase() {
        var m = window.location.pathname.match(/^\\/plans\\/([^/]+)\\/(\\d{4}-\\d{2}-\\d{2})/);
        return m ? { source: m[1], date: m[2] } : null;
      }

      function saveDraft(actionsEl) {
        var textarea = findEditTextarea(actionsEl);
        if (!textarea) return;
        var newText = textarea.value;
        var originalText = actionsEl.dataset.originalText || '';
        var draftIndex = actionsEl.dataset.draftIndex || '';
        var base = planUrlBase();
        if (!base) {
          setStatus(actionsEl, 'Cannot determine plan URL.', true);
          return;
        }
        var url = '/plans/' + encodeURIComponent(base.source) +
                  '/' + encodeURIComponent(base.date) +
                  '/draft/' + encodeURIComponent(draftIndex);

        setStatus(actionsEl, 'Saving…', false);
        var saveBtn = actionsEl.querySelector('.draft-save');
        var cancelBtn = actionsEl.querySelector('.draft-cancel');
        if (saveBtn) saveBtn.disabled = true;
        if (cancelBtn) cancelBtn.disabled = true;

        fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ originalText: originalText, newText: newText })
        }).then(function (res) {
          if (res.ok) {
            // Re-render with fresh data.
            window.location.reload();
            return;
          }
          return res.json().catch(function () { return null; }).then(function (body) {
            var msg = (body && body.error) ? body.error : ('Save failed (' + res.status + ').');
            setStatus(actionsEl, msg, true);
            if (saveBtn) saveBtn.disabled = false;
            if (cancelBtn) cancelBtn.disabled = false;
          });
        }).catch(function (err) {
          setStatus(actionsEl, 'Network error: ' + (err && err.message ? err.message : 'unknown'), true);
          if (saveBtn) saveBtn.disabled = false;
          if (cancelBtn) cancelBtn.disabled = false;
        });
      }

      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;

        var copyBtn = t.closest('.draft-copy');
        if (copyBtn) {
          e.preventDefault();
          var actions = copyBtn.closest('.draft-actions');
          if (actions) {
            // In edit mode, copy from the textarea so the user can copy-as-typed.
            var text;
            if (actions.dataset.mode === 'editing') {
              var ta = findEditTextarea(actions);
              text = ta ? ta.value : '';
            } else {
              text = getDraftText(actions);
            }
            if (text) copyText(text, copyBtn);
          }
          return;
        }

        var emailLink = t.closest('.draft-email');
        if (emailLink) {
          e.preventDefault();
          var actions2 = emailLink.closest('.draft-actions');
          var body;
          if (actions2 && actions2.dataset.mode === 'editing') {
            var ta2 = findEditTextarea(actions2);
            body = ta2 ? ta2.value : '';
          } else {
            body = actions2 ? getDraftText(actions2) : '';
          }
          var email = emailLink.dataset.email || '';
          var subject = emailLink.dataset.subject || '';
          var url = 'mailto:' + email;
          var qs = [];
          if (subject) qs.push('subject=' + encodeURIComponent(subject));
          if (body) qs.push('body=' + encodeURIComponent(body));
          if (qs.length) url += '?' + qs.join('&');
          window.location.href = url;
          return;
        }

        var editBtn = t.closest('.draft-edit');
        if (editBtn) {
          e.preventDefault();
          var ea = editBtn.closest('.draft-actions');
          if (ea) enterEditMode(ea);
          return;
        }

        var saveBtn = t.closest('.draft-save');
        if (saveBtn) {
          e.preventDefault();
          var sa = saveBtn.closest('.draft-actions');
          if (sa) saveDraft(sa);
          return;
        }

        var cancelBtn = t.closest('.draft-cancel');
        if (cancelBtn) {
          e.preventDefault();
          var ca = cancelBtn.closest('.draft-actions');
          if (ca) exitEditMode(ca);
          return;
        }
      });

      // Keyboard shortcuts inside the edit textarea: Cmd/Ctrl+Enter saves, Escape cancels.
      document.addEventListener('keydown', function (e) {
        var ta = e.target;
        if (!ta || ta.tagName !== 'TEXTAREA' || !ta.classList || !ta.classList.contains('draft-textarea')) return;
        var actions = ta.nextElementSibling;
        if (!actions || !actions.classList.contains('draft-actions')) return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault();
          saveDraft(actions);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          exitEditMode(actions);
        }
      });
    })();
  `;
}
