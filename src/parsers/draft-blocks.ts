/**
 * Draft block parser for daily plans.
 *
 * Operates on raw markdown source — independent of the rendered HTML — so the
 * results survive any rendering changes downstream. A "draft block" is the first
 * fenced code block or blockquote inside a heading-bounded section that contains
 * a `**Send to:**` (or `**Channel:**`) paragraph. Drafts are numbered in document
 * order starting at 0; the index is the stable handle used by the save endpoint.
 */
import MarkdownIt from "markdown-it";

export type DraftKind = "fenced" | "blockquote";

export interface DraftBlock {
  /** 0-based position in document order. */
  index: number;
  /** Raw body text from markdown source (no fence markers, no `>` prefixes). */
  bodyText: string;
  kind: DraftKind;
  /** 0-based inclusive line range of the body in the source. For empty bodies, end < start. */
  bodyStartLine: number;
  bodyEndLine: number;
  /** Line of the opening fence (fenced kind only). */
  fenceLine?: number;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

const SEND_TO_INLINE_RE = /^\s*\*\*\s*(?:Send to|Channel)\s*:?\s*\*\*/i;

export function findDraftBlocks(raw: string): DraftBlock[] {
  const tokens = md.parse(raw, {});
  const lines = raw.split("\n");
  const drafts: DraftBlock[] = [];

  let sawSendTo = false;
  let augmentedThisSection = false;
  let blockquoteDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "heading_open") {
      sawSendTo = false;
      augmentedThisSection = false;
      continue;
    }

    if (t.type === "blockquote_open") blockquoteDepth++;
    if (t.type === "blockquote_close") blockquoteDepth--;

    if (t.type === "paragraph_open" && tokens[i + 1]?.type === "inline") {
      const inline = tokens[i + 1].content;
      if (SEND_TO_INLINE_RE.test(inline)) {
        sawSendTo = true;
      }
    }

    if (!sawSendTo || augmentedThisSection) continue;

    if (t.type === "fence" && t.map) {
      const openLine = t.map[0];
      const endExclusive = t.map[1];
      // Body lives between the open fence and the close fence.
      // markdown-it sets map[1] to one past the line *after* the close fence in
      // most cases, so the close fence is at endExclusive - 1 and body lines
      // run openLine + 1 .. endExclusive - 2 inclusive. A trailing blank line
      // after the close fence is common in markdown-it output but we trim
      // conservatively to the close-fence line.
      const closeFenceLine = findCloseFenceLine(lines, openLine, t.markup, endExclusive);
      drafts.push({
        index: drafts.length,
        bodyText: stripTrailingNewline(t.content),
        kind: "fenced",
        bodyStartLine: openLine + 1,
        bodyEndLine: closeFenceLine - 1,
        fenceLine: openLine,
      });
      augmentedThisSection = true;
      continue;
    }

    if (t.type === "blockquote_open" && t.map && blockquoteDepth === 1) {
      const startLine = t.map[0];
      const closeIdx = findMatchingBlockquoteClose(tokens, i);
      const endExclusive =
        closeIdx >= 0 && tokens[closeIdx].map ? tokens[closeIdx].map![1] : t.map[1];
      const endLine = endExclusive - 1;

      const bodyLines: string[] = [];
      for (let k = startLine; k <= endLine; k++) {
        const ln = lines[k] ?? "";
        const m = ln.match(/^(\s*)>\s?(.*)$/);
        bodyLines.push(m ? m[2] : ln);
      }
      drafts.push({
        index: drafts.length,
        bodyText: bodyLines.join("\n").replace(/\s+$/, ""),
        kind: "blockquote",
        bodyStartLine: startLine,
        bodyEndLine: endLine,
      });
      augmentedThisSection = true;
    }
  }

  return drafts;
}

/**
 * Compare-and-swap replacement of a draft's body. Returns the new full markdown
 * if the original body matches what's currently on disk for the given draft
 * index, otherwise returns a reason. Caller writes the result to disk.
 */
export function replaceDraftBody(
  raw: string,
  draftIndex: number,
  originalBody: string,
  newBody: string
):
  | { ok: true; newRaw: string }
  | { ok: false; reason: "not-found" | "conflict" | "empty" } {
  if (newBody.trim().length === 0) {
    return { ok: false, reason: "empty" };
  }

  const drafts = findDraftBlocks(raw);
  const draft = drafts[draftIndex];
  if (!draft) return { ok: false, reason: "not-found" };

  if (canonicalize(draft.bodyText) !== canonicalize(originalBody)) {
    return { ok: false, reason: "conflict" };
  }

  const lines = raw.split("\n");
  const newBodyLines =
    draft.kind === "fenced"
      ? newBody.split("\n")
      : newBody.split("\n").map((l) => (l.length === 0 ? ">" : "> " + l));

  const before = lines.slice(0, draft.bodyStartLine);
  // bodyEndLine can be < bodyStartLine for empty bodies; slice handles that gracefully.
  const after = lines.slice(Math.max(draft.bodyEndLine + 1, draft.bodyStartLine));
  const newLines = [...before, ...newBodyLines, ...after];

  return { ok: true, newRaw: newLines.join("\n") };
}

function canonicalize(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\s+$/g, "").replace(/[ \t]+\n/g, "\n");
}

function stripTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s.slice(0, -1) : s;
}

function findCloseFenceLine(
  lines: string[],
  openLine: number,
  markup: string,
  endExclusive: number
): number {
  // Walk forward from openLine + 1 looking for a line that begins with the same
  // fence character as `markup` (length >= markup length). Bound by endExclusive
  // as a safety cap.
  if (!markup) return endExclusive - 1;
  const fenceChar = markup[0];
  const minLen = markup.length;
  for (let i = openLine + 1; i < Math.min(lines.length, endExclusive); i++) {
    const trimmed = lines[i].replace(/^\s{0,3}/, "");
    if (
      trimmed.startsWith(fenceChar.repeat(minLen)) &&
      /^[`~]+\s*$/.test(trimmed)
    ) {
      return i;
    }
  }
  // Fall back to the last line in range if no explicit close found (unclosed fence).
  return Math.max(openLine + 1, endExclusive - 1);
}

function findMatchingBlockquoteClose(tokens: ReturnType<typeof md.parse>, openIdx: number): number {
  let depth = 1;
  for (let j = openIdx + 1; j < tokens.length; j++) {
    if (tokens[j].type === "blockquote_open") depth++;
    if (tokens[j].type === "blockquote_close") {
      depth--;
      if (depth === 0) return j;
    }
  }
  return -1;
}
