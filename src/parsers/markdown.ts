import { readFileSync, existsSync } from "fs";
import MarkdownIt from "markdown-it";
import { escapeAttr } from "../utils.js";

// Markdown is rendered without HTML sanitization. This is deliberate:
// synthesis-console is a local-only tool that reads the user's own files.
// Sanitizing would break legitimate HTML in markdown (tables, embeds, etc).
// If adapting this code for multi-tenant use, add DOMPurify or similar.
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});

// Enable task list checkboxes (- [x] and - [ ])
md.use(taskListPlugin);

function taskListPlugin(md: MarkdownIt) {
  md.core.ruler.after("inline", "task-lists", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "inline") continue;
      const content = tokens[i].content;
      if (!content) continue;

      // Check if this inline token starts with [ ] or [x]
      if (content.startsWith("[x] ") || content.startsWith("[X] ")) {
        tokens[i].content = content.slice(4);
        // Find the parent list item and mark it
        for (let j = i - 1; j >= 0; j--) {
          if (tokens[j].type === "list_item_open") {
            tokens[j].attrSet("class", "task-list-item");
            break;
          }
        }
        // Prepend checked checkbox
        const checkToken = new state.Token("html_inline", "", 0);
        checkToken.content = '<input type="checkbox" checked disabled> ';
        tokens[i].children = tokens[i].children || [];
        tokens[i].children.unshift(checkToken);
      } else if (content.startsWith("[ ] ")) {
        tokens[i].content = content.slice(4);
        for (let j = i - 1; j >= 0; j--) {
          if (tokens[j].type === "list_item_open") {
            tokens[j].attrSet("class", "task-list-item");
            break;
          }
        }
        const checkToken = new state.Token("html_inline", "", 0);
        checkToken.content = '<input type="checkbox" disabled> ';
        tokens[i].children = tokens[i].children || [];
        tokens[i].children.unshift(checkToken);
      }
    }
  });
}

export function renderMarkdown(content: string): string {
  return md.render(content);
}

export function readAndRenderMarkdown(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  return renderMarkdown(raw);
}

export function readMarkdownRaw(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

/**
 * Pre-process daily plan markdown to fix patterns that break standard parsers:
 * - Strikethrough around code fences (~~```...```) from sent draft messages
 * - Other daily-plan-specific formatting
 */
function preprocessPlanMarkdown(raw: string): string {
  // Fix strikethrough wrapping code fences: ~~```\n...\n```
  // This happens when a drafted message is struck through after sending.
  // Strip the ~~ from fence markers so the fence renders properly,
  // and wrap the whole block in strikethrough via HTML.
  let result = raw;

  // Pattern: ~~``` at line start (opening fence with strikethrough)
  // Replace with a blockquote (since it's a "sent" message) and remove the broken fence
  result = result.replace(
    /^~~```\s*$/gm,
    "```"
  );

  return result;
}

/**
 * Render markdown for daily plans with:
 * - Pre-processing for daily-plan-specific patterns
 * - #channel-name → Slack deep link
 */
export function readAndRenderPlanMarkdown(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const preprocessed = preprocessPlanMarkdown(raw);
  let html = md.render(preprocessed);

  // Convert #channel-name references to Slack deep links
  // Matches #word-word patterns not inside HTML tags or HTML entities
  html = html.replace(
    /(?<![<\w/&])#([a-zA-Z][\w-]{1,79})(?![^<]*>)/g,
    '<a href="slack://channel?team=&amp;id=&amp;name=$1" title="Open #$1 in Slack">#$1</a>'
  );

  // Insert a notice before draft message sections reminding users to review
  const draftNotice = `<div class="draft-notice" role="note">
    <strong>Review before sending.</strong> These drafts are grounded in real data &mdash;
    code commits, test results, deployment logs, Slack threads, and project context &mdash;
    but they are starting points, not final messages.
    Read each one, edit it in your own voice, and add the personal touch only you can.
    Human-to-human communication deserves human effort.
  </div>`;

  // Insert before headings that contain draft/unsent language
  html = html.replace(
    /(<h2[^>]*>(?:[^<]*(?:Draft|Unsent|Ready to Send)[^<]*)<\/h2>)/i,
    draftNotice + "\n$1"
  );

  // Augment draft message blocks with action buttons (copy / open in Slack / compose email)
  html = augmentDraftBlocks(html);

  return html;
}

interface SendToTarget {
  kind: "slack-channel" | "slack-dm" | "slack-user" | "slack-thread" | "email" | "unknown";
  channelName?: string;
  channelId?: string;
  userId?: string;
  threadTs?: string;
  email?: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseSendTo(htmlFragment: string): SendToTarget | null {
  const text = decodeEntities(htmlFragment.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  if (!text) return null;

  // Email — preferred when present, since email syntax can incidentally include @ symbols
  // that would otherwise get matched as user mentions
  const emailMatch = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
  if (emailMatch && !/@[A-Z0-9]{6,}/.test(text)) {
    return { kind: "email", email: emailMatch[0] };
  }

  const threadMatch = text.match(/TS:\s*([\d.]+)/i);
  const dmIdMatch = text.match(/\b(D[A-Z0-9]{6,})\b/);
  const userIdMatch = text.match(/\b(U[A-Z0-9]{6,})\b/);
  const channelMatch = text.match(/#([a-zA-Z][\w-]+)/);

  if (threadMatch) {
    return {
      kind: "slack-thread",
      threadTs: threadMatch[1],
      channelId: dmIdMatch?.[1],
      userId: userIdMatch?.[1],
      channelName: channelMatch?.[1],
    };
  }

  if (dmIdMatch) {
    return { kind: "slack-dm", channelId: dmIdMatch[1], userId: userIdMatch?.[1] };
  }

  if (userIdMatch) {
    return { kind: "slack-user", userId: userIdMatch[1] };
  }

  if (channelMatch) {
    return { kind: "slack-channel", channelName: channelMatch[1] };
  }

  return null;
}

function renderDraftActions(target: SendToTarget | null, subject?: string): string {
  const parts: string[] = [];
  parts.push(
    `<button type="button" class="draft-action draft-copy" data-action="copy" aria-label="Copy draft to clipboard">Copy</button>`
  );

  if (target) {
    if (target.kind === "slack-channel" && target.channelName) {
      const url = `slack://channel?team=&id=&name=${encodeURIComponent(target.channelName)}`;
      parts.push(
        `<a class="draft-action draft-slack" href="${escapeAttr(url)}">Open #${escapeAttr(target.channelName)} in Slack</a>`
      );
    } else if (target.kind === "slack-dm" && target.channelId) {
      const url = `slack://channel?id=${encodeURIComponent(target.channelId)}`;
      parts.push(
        `<a class="draft-action draft-slack" href="${escapeAttr(url)}">Open DM in Slack</a>`
      );
    } else if (target.kind === "slack-user" && target.userId) {
      const url = `slack://user?id=${encodeURIComponent(target.userId)}`;
      parts.push(
        `<a class="draft-action draft-slack" href="${escapeAttr(url)}">Open DM in Slack</a>`
      );
    } else if (target.kind === "slack-thread" && (target.channelId || target.userId)) {
      const idForUrl = target.channelId || target.userId!;
      const url = `slack://channel?id=${encodeURIComponent(idForUrl)}&message=${encodeURIComponent(target.threadTs || "")}`;
      parts.push(
        `<a class="draft-action draft-slack" href="${escapeAttr(url)}">Open thread in Slack</a>`
      );
    } else if (target.kind === "email" && target.email) {
      // Body is filled client-side from the message element; href has subject only as a fallback.
      const fallbackHref =
        `mailto:${encodeURIComponent(target.email)}` +
        (subject ? `?subject=${encodeURIComponent(subject)}` : "");
      parts.push(
        `<a class="draft-action draft-email" href="${escapeAttr(fallbackHref)}" data-action="email" data-email="${escapeAttr(target.email)}" data-subject="${escapeAttr(subject || "")}">Compose email</a>`
      );
    }
  }

  return `<div class="draft-actions" role="group" aria-label="Draft actions">${parts.join("")}</div>`;
}

/**
 * Walk the rendered HTML, find draft sections (heading-bounded sections that contain a
 * `<strong>Send to:</strong>` paragraph), and append an action bar after the first
 * message container (fenced code block or blockquote) following that paragraph.
 *
 * Conservative by design: only the first message container per section is augmented,
 * and a section without a Send-to/Channel marker is left untouched.
 */
function augmentDraftBlocks(html: string): string {
  const sections = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || /^<h[1-6]/.test(section)) continue;

    const sendToRegex = /<p>\s*<strong>(?:Send to|Channel):?<\/strong>([\s\S]*?)<\/p>/i;
    const sendToMatch = section.match(sendToRegex);
    if (!sendToMatch || sendToMatch.index === undefined) continue;

    const target = parseSendTo(sendToMatch[1]);

    const subjectMatch = section.match(/<p>\s*<strong>Subject:?<\/strong>([\s\S]*?)<\/p>/i);
    const subject = subjectMatch
      ? decodeEntities(subjectMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      : undefined;

    const sendToEnd = sendToMatch.index + sendToMatch[0].length;
    const before = section.slice(0, sendToEnd);
    const after = section.slice(sendToEnd);

    const actionsHtml = renderDraftActions(target, subject);
    const newAfter = after.replace(
      /(<pre><code[^>]*>[\s\S]*?<\/code><\/pre>|<blockquote>[\s\S]*?<\/blockquote>)/,
      (match) => match + actionsHtml
    );

    sections[i] = before + newAfter;
  }

  return sections.join("");
}
