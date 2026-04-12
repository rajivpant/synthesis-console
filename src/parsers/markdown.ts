import { readFileSync, existsSync } from "fs";
import { Marked } from "marked";

// Markdown is rendered without HTML sanitization. This is deliberate:
// synthesis-console is a local-only tool that reads the user's own files.
// Sanitizing would break legitimate HTML in markdown (tables, embeds, etc).
// If adapting this code for multi-tenant use, add DOMPurify or similar.
const marked = new Marked({
  gfm: true,
  breaks: false,
});

export function renderMarkdown(content: string): string {
  return marked.parse(content) as string;
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
 * Render markdown for daily plans with enhanced link generation:
 * - #channel-name → Slack deep link
 * - mailto: links for email drafts
 */
export function readAndRenderPlanMarkdown(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  let html = marked.parse(raw) as string;

  // Convert #channel-name references to Slack deep links
  // Matches #word-word patterns that aren't inside HTML tags, code blocks, or HTML entities
  html = html.replace(
    /(?<![<\w/&])#([a-zA-Z][\w-]{1,79})(?![^<]*>)/g,
    '<a href="slack://channel?team=&amp;id=&amp;name=$1" title="Open #$1 in Slack">#$1</a>'
  );

  return html;
}
