import { readFileSync, existsSync } from "fs";
import MarkdownIt from "markdown-it";

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

  return html;
}
