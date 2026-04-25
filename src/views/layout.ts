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

      // Slack directory island: name/alias → user ID, channel name → channel ID.
      // Used for Smart Copy: rewrite @Name and #channel-name to canonical Slack
      // syntax (<@U...>, <#C...|name>) before writing to the clipboard so
      // mentions resolve when the message is pasted-and-sent in Slack.
      var __slackDir = (function () {
        try {
          var el = document.getElementById('slack-directory');
          if (!el) return { users: [], channels: [], userByKey: {}, channelByName: {} };
          var data = JSON.parse(el.textContent || '{}');
          var userByKey = {};
          (data.users || []).forEach(function (u) {
            var keys = [u.name].concat(u.aliases || []);
            keys.forEach(function (k) {
              if (!k) return;
              var nk = k.trim().toLowerCase().replace(/\\s+/g, ' ');
              if (nk && !(nk in userByKey)) userByKey[nk] = u;
            });
          });
          var channelByName = {};
          (data.channels || []).forEach(function (c) {
            channelByName[c.name.toLowerCase()] = c;
          });
          return { users: data.users || [], channels: data.channels || [], userByKey: userByKey, channelByName: channelByName };
        } catch (_) {
          return { users: [], channels: [], userByKey: {}, channelByName: {} };
        }
      })();

      function escapeRegex(s) {
        return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
      }

      function smartResolveMentions(text) {
        if (!text) return text;
        var result = text;

        // Channels: #name -> <#C...|name> if mapped. Skip if already preceded
        // by a left angle bracket (already canonical syntax).
        result = result.replace(/(?<!<)#([a-zA-Z][\\w-]{1,79})\\b/g, function (m, name) {
          var ch = __slackDir.channelByName[name.toLowerCase()];
          return ch ? '<#' + ch.id + '|' + name + '>' : m;
        });

        // @U... → <@U...>; skip if already canonical.
        result = result.replace(/(?<!<)@(U[A-Z0-9]{6,})\\b/g, function (_m, id) { return '<@' + id + '>'; });

        // @<DisplayName> from directory; longest first to avoid partial overrides.
        var keys = Object.keys(__slackDir.userByKey).sort(function (a, b) { return b.length - a.length; });
        if (keys.length > 0) {
          var alt = keys.map(escapeRegex).join('|');
          var re = new RegExp('(?<!<)@(' + alt + ')\\\\b', 'gi');
          result = result.replace(re, function (m, raw) {
            var u = __slackDir.userByKey[raw.trim().toLowerCase().replace(/\\s+/g, ' ')];
            return u ? '<@' + u.id + '>' : m;
          });
        }

        return result;
      }

      function getDraftText(actionsEl) {
        var prev = actionsEl.previousElementSibling;
        // If actionsEl is a direct sibling of pre/blockquote, prev is that. If it's
        // inside a draft-sent-body wrapper, descend. Try both.
        if (prev && prev.classList && prev.classList.contains('draft-sent-body')) {
          var inner = prev.querySelector('pre, blockquote');
          if (inner) return (inner.innerText || inner.textContent || '').replace(/\\u00A0/g, ' ').trim();
        }
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
            // Smart Copy: rewrite @Name and #channel-name to canonical Slack
            // mention syntax so they resolve when pasted-and-sent in Slack.
            if (text) text = smartResolveMentions(text);
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

        var sendBtn = t.closest('.draft-send');
        if (sendBtn) {
          e.preventDefault();
          var sendActions = sendBtn.closest('.draft-actions');
          if (sendActions) openSendModal(sendActions);
          return;
        }
      });

      // ---- Send-to-Slack confirm modal ----
      // Created on demand and reused across sends.
      var __sendModal = null;

      function buildSendModal() {
        var overlay = document.createElement('div');
        overlay.className = 'send-modal-overlay';
        overlay.innerHTML = '<div class="send-modal" role="dialog" aria-labelledby="send-modal-title">' +
          '<h3 id="send-modal-title" class="send-modal-title">Send to Slack</h3>' +
          '<div class="send-modal-meta"></div>' +
          '<div class="send-modal-mentions"></div>' +
          '<div class="send-modal-preview-label">Preview (with mentions resolved):</div>' +
          '<pre class="send-modal-preview"></pre>' +
          '<div class="send-modal-status" role="status" aria-live="polite"></div>' +
          '<div class="send-modal-actions">' +
            '<button type="button" class="send-modal-cancel">Cancel</button>' +
            '<button type="button" class="send-modal-confirm">Send</button>' +
          '</div>' +
        '</div>';
        overlay.addEventListener('click', function (ev) {
          if (ev.target === overlay) closeSendModal();
        });
        overlay.querySelector('.send-modal-cancel').addEventListener('click', closeSendModal);
        overlay.querySelector('.send-modal-confirm').addEventListener('click', confirmSend);
        document.body.appendChild(overlay);
        return overlay;
      }

      function ensureSendModal() {
        if (!__sendModal) __sendModal = buildSendModal();
        return __sendModal;
      }

      function setSendModalStatus(msg, isError) {
        var modal = ensureSendModal();
        var s = modal.querySelector('.send-modal-status');
        s.textContent = msg || '';
        s.classList.toggle('send-modal-status-error', !!isError);
      }

      function setSendModalButtonsDisabled(disabled) {
        var modal = ensureSendModal();
        modal.querySelector('.send-modal-confirm').disabled = !!disabled;
        modal.querySelector('.send-modal-cancel').disabled = !!disabled;
      }

      var __sendModalTargetActions = null;

      function openSendModal(actionsEl) {
        __sendModalTargetActions = actionsEl;
        var modal = ensureSendModal();
        modal.classList.add('visible');
        setSendModalStatus('', false);
        setSendModalButtonsDisabled(false);

        var meta = modal.querySelector('.send-modal-meta');
        var mentionsEl = modal.querySelector('.send-modal-mentions');
        var preview = modal.querySelector('.send-modal-preview');

        meta.textContent = 'Loading…';
        mentionsEl.textContent = '';
        preview.textContent = '';

        var base = planUrlBase();
        var idx = actionsEl.dataset.draftIndex;
        if (!base || idx === undefined) {
          meta.textContent = 'Could not determine plan URL.';
          return;
        }

        var url = '/plans/' + encodeURIComponent(base.source) +
                  '/' + encodeURIComponent(base.date) +
                  '/draft/' + encodeURIComponent(idx) +
                  '/preflight';

        fetch(url).then(function (res) {
          return res.json().then(function (json) { return { ok: res.ok, body: json }; });
        }).then(function (r) {
          if (!r.ok || !r.body || r.body.ok === false) {
            meta.textContent = (r.body && r.body.error) ? r.body.error : 'Preflight failed.';
            setSendModalButtonsDisabled(true);
            return;
          }
          var b = r.body;
          var sendTo = b.sendToText ? b.sendToText.replace(/\\s+/g, ' ').trim() : '(unknown target)';
          meta.innerHTML = '<strong>To:</strong> ' + escapeText(sendTo);

          var mlines = [];
          if (b.mentions && b.mentions.users && b.mentions.users.length > 0) {
            mlines.push('Will mention: ' + b.mentions.users.map(function (u) { return '@' + u.display; }).join(', '));
          }
          if (b.mentions && b.mentions.channels && b.mentions.channels.length > 0) {
            mlines.push('Channels: ' + b.mentions.channels.map(function (c) { return '#' + c.display; }).join(', '));
          }
          if (b.mentions && b.mentions.unresolved && b.mentions.unresolved.length > 0) {
            mlines.push('Unresolved (will send as plain text): ' + b.mentions.unresolved.map(function (u) { return u.raw; }).join(', '));
          }
          mentionsEl.textContent = mlines.join('\\n');

          preview.textContent = b.bodyResolved || b.bodyOriginal || '';

          if (!b.tokenConfigured) {
            meta.innerHTML += ' <span class="send-modal-warn">(Slack token not configured — Send disabled.)</span>';
            setSendModalButtonsDisabled(true);
          }
        }).catch(function (err) {
          meta.textContent = 'Network error: ' + (err && err.message ? err.message : 'unknown');
          setSendModalButtonsDisabled(true);
        });
      }

      function closeSendModal() {
        if (__sendModal) __sendModal.classList.remove('visible');
        __sendModalTargetActions = null;
      }

      function confirmSend() {
        var actions = __sendModalTargetActions;
        if (!actions) return;
        var base = planUrlBase();
        if (!base) { setSendModalStatus('Cannot determine plan URL.', true); return; }
        var idx = actions.dataset.draftIndex;
        var url = '/plans/' + encodeURIComponent(base.source) +
                  '/' + encodeURIComponent(base.date) +
                  '/draft/' + encodeURIComponent(idx) +
                  '/send';

        setSendModalStatus('Sending…', false);
        setSendModalButtonsDisabled(true);

        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmed: true })
        }).then(function (res) {
          return res.json().then(function (json) { return { ok: res.ok, body: json }; });
        }).then(function (r) {
          if (r.ok && r.body && r.body.ok) {
            if (r.body.warning) {
              setSendModalStatus(r.body.warning, false);
              setTimeout(function () { window.location.reload(); }, 2500);
            } else {
              window.location.reload();
            }
            return;
          }
          var msg = (r.body && r.body.error) ? r.body.error : ('Send failed (' + (r.ok ? 'unknown' : 'HTTP ' + r.body && r.body.status) + ').');
          setSendModalStatus(msg, true);
          setSendModalButtonsDisabled(false);
        }).catch(function (err) {
          setSendModalStatus('Network error: ' + (err && err.message ? err.message : 'unknown'), true);
          setSendModalButtonsDisabled(false);
        });
      }

      function escapeText(s) {
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }

      // Escape-key on the modal closes it.
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && __sendModal && __sendModal.classList.contains('visible')) {
          closeSendModal();
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
