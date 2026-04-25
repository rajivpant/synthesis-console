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
  /** Raw text after `**Send to:**` (or `**Channel:**`) in the markdown source. */
  sendToText?: string;
  /** Raw text after `**Subject:**` if present. */
  subjectText?: string;
  /**
   * 0-based line of the section's heading (h1-h6 immediately preceding this draft).
   * Used by the send endpoint to append a `**Sent:**` marker after the body.
   */
  sectionHeadingLine?: number;
  /** 0-based line one past the end of the section (heading exclusive of next). */
  sectionEndLine?: number;
  /** True if a `**Sent:**` marker is already present in this section. */
  alreadySent: boolean;
  /** Parsed `**Sent:**` ISO timestamp, if any. */
  sentAt?: string;
  /** Parsed Slack permalink from a `**Sent:**` marker, if any. */
  sentPermalink?: string;
  /** Parsed Slack message TS from a `**Sent:**` marker, if any. */
  sentTs?: string;
}

const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

const SEND_TO_INLINE_RE = /^\s*\*\*\s*(?:Send to|Channel)\s*:?\s*\*\*/i;
const SUBJECT_INLINE_RE = /^\s*\*\*\s*Subject\s*:?\s*\*\*/i;
const SENT_INLINE_RE = /^\s*\*\*\s*Sent(?:\s*at)?\s*:?\s*\*\*/i;

export function findDraftBlocks(raw: string): DraftBlock[] {
  const tokens = md.parse(raw, {});
  const lines = raw.split("\n");
  const drafts: DraftBlock[] = [];

  let sawSendTo = false;
  let augmentedThisSection = false;
  let currentSendToText: string | undefined;
  let currentSubjectText: string | undefined;
  let currentSectionHeadingLine: number | undefined;
  let currentSectionEndLine: number | undefined;
  let currentDraftIdx: number | undefined; // index in drafts[] for the current section, set when we push
  let blockquoteDepth = 0;

  // Pre-compute heading line ranges so each section knows its end line.
  // Walk tokens to find heading_open positions, then attribute section ends.
  const headingLines: number[] = [];
  for (const t of tokens) {
    if (t.type === "heading_open" && t.map) headingLines.push(t.map[0]);
  }

  function endLineOfSectionStartingAt(headingLine: number): number {
    const idx = headingLines.indexOf(headingLine);
    if (idx >= 0 && idx + 1 < headingLines.length) {
      return headingLines[idx + 1] - 1;
    }
    return lines.length - 1;
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "heading_open") {
      sawSendTo = false;
      augmentedThisSection = false;
      currentSendToText = undefined;
      currentSubjectText = undefined;
      currentSectionHeadingLine = t.map ? t.map[0] : undefined;
      currentSectionEndLine =
        currentSectionHeadingLine !== undefined
          ? endLineOfSectionStartingAt(currentSectionHeadingLine)
          : undefined;
      currentDraftIdx = undefined;
      continue;
    }

    if (t.type === "blockquote_open") blockquoteDepth++;
    if (t.type === "blockquote_close") blockquoteDepth--;

    if (t.type === "paragraph_open" && tokens[i + 1]?.type === "inline") {
      const inline = tokens[i + 1].content;
      if (SEND_TO_INLINE_RE.test(inline)) {
        sawSendTo = true;
        currentSendToText = inline.replace(SEND_TO_INLINE_RE, "").trim();
      } else if (SUBJECT_INLINE_RE.test(inline)) {
        currentSubjectText = inline.replace(SUBJECT_INLINE_RE, "").trim();
      } else if (SENT_INLINE_RE.test(inline) && currentDraftIdx !== undefined) {
        // Annotate the most-recently-pushed draft in this section as already sent.
        const sentTail = inline.replace(SENT_INLINE_RE, "").trim();
        const draft = drafts[currentDraftIdx];
        if (draft) {
          draft.alreadySent = true;
          draft.sentAt = parseSentTimestamp(sentTail);
          draft.sentTs = parseSentTs(sentTail);
          draft.sentPermalink = parseSentPermalink(sentTail);
        }
      }
    }

    if (!sawSendTo || augmentedThisSection) continue;

    if (t.type === "fence" && t.map) {
      const openLine = t.map[0];
      const endExclusive = t.map[1];
      const closeFenceLine = findCloseFenceLine(lines, openLine, t.markup, endExclusive);
      currentDraftIdx = drafts.length;
      drafts.push({
        index: drafts.length,
        bodyText: stripTrailingNewline(t.content),
        kind: "fenced",
        bodyStartLine: openLine + 1,
        bodyEndLine: closeFenceLine - 1,
        fenceLine: openLine,
        sendToText: currentSendToText,
        subjectText: currentSubjectText,
        sectionHeadingLine: currentSectionHeadingLine,
        sectionEndLine: currentSectionEndLine,
        alreadySent: false,
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
      currentDraftIdx = drafts.length;
      drafts.push({
        index: drafts.length,
        bodyText: bodyLines.join("\n").replace(/\s+$/, ""),
        kind: "blockquote",
        bodyStartLine: startLine,
        bodyEndLine: endLine,
        sendToText: currentSendToText,
        subjectText: currentSubjectText,
        sectionHeadingLine: currentSectionHeadingLine,
        sectionEndLine: currentSectionEndLine,
        alreadySent: false,
      });
      augmentedThisSection = true;
    }
  }

  return drafts;
}

function parseSentTimestamp(s: string): string | undefined {
  // Accept "2026-04-25 02:00:00 EDT" or "2026-04-25T02:00:00-04:00" or "Apr 25 2026 02:00 EDT"
  const isoMatch = s.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\s*\w{2,5})?)/);
  return isoMatch ? isoMatch[1].trim() : undefined;
}

function parseSentTs(s: string): string | undefined {
  const m = s.match(/TS\s*[=:]\s*([\d.]+)/i);
  return m ? m[1] : undefined;
}

function parseSentPermalink(s: string): string | undefined {
  const m = s.match(/(https?:\/\/[^\s)]+)/);
  return m ? m[1] : undefined;
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

/**
 * Append a `**Sent:** ...` marker after the draft body. Idempotent: if the
 * draft is already marked sent, returns "already-sent" without rewriting.
 */
export function markDraftAsSent(
  raw: string,
  draftIndex: number,
  meta: { ts: string; permalink?: string; sentAtIso: string }
):
  | { ok: true; newRaw: string }
  | { ok: false; reason: "not-found" | "already-sent" } {
  const drafts = findDraftBlocks(raw);
  const draft = drafts[draftIndex];
  if (!draft) return { ok: false, reason: "not-found" };
  if (draft.alreadySent) return { ok: false, reason: "already-sent" };

  const lines = raw.split("\n");

  // Insertion line: immediately after the body closes (and its trailing fence
  // for fenced drafts).
  const insertAt =
    draft.kind === "fenced" ? draft.bodyEndLine + 2 : draft.bodyEndLine + 1;

  const permalinkPart = meta.permalink ? ` ${meta.permalink}` : "";
  const sentLine = `**Sent:** ${meta.sentAtIso} (TS=${meta.ts})${permalinkPart}`;

  // Insert with a blank line before, unless the line already at `insertAt` is
  // blank (avoid stacking blank lines).
  const needsLeadingBlank = (lines[insertAt - 1] ?? "").trim() !== "";
  const block = needsLeadingBlank ? ["", sentLine] : [sentLine];

  const newLines = [...lines.slice(0, insertAt), ...block, ...lines.slice(insertAt)];
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
