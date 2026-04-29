import { readFileSync, existsSync, statSync } from "fs";
import MarkdownIt from "markdown-it";
import { escapeAttr, escapeHtml } from "../utils.js";
import { findDraftBlocks } from "./draft-blocks.js";
import type { DraftBlock } from "./draft-blocks.js";
import { findPlanSections } from "./plan-sections.js";
import type { PlanSection } from "./plan-sections.js";
import { renderMentionPills, resolveMentions, listResolvedMentions } from "./slack-mentions.js";
import type { SlackDirectory } from "./slack-directory.js";
import { emptyDirectory } from "./slack-directory.js";
import { buildChannelUrl, buildUserDmUrl } from "../integrations/slack-urls.js";
import type { SlackWorkspaceConfig } from "../integrations/slack-urls.js";

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
 * - Slack mention pills for `<@U...>` and `<#C...|name>` canonical syntax
 * - Draft action bars with copy / edit / open-in-Slack / send-via-Slack
 *
 * `editable` controls whether the draft action bar surfaces an Edit button.
 * `slackEnabled` controls whether the Send-to-Slack button is rendered.
 * Demo sources pass `editable: false` and `slackEnabled: false`.
 *
 * `directory` provides the user/channel mapping consumed by mention rendering
 * and (later) by Smart Copy on the client.
 */
export function readAndRenderPlanMarkdown(
  filePath: string,
  opts: {
    editable?: boolean;
    slackEnabled?: boolean;
    directory?: SlackDirectory;
    slack?: SlackWorkspaceConfig;
  } = {}
): string | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const drafts = findDraftBlocks(raw);
  const directory = opts.directory ?? emptyDirectory();
  const slackCfg: SlackWorkspaceConfig = opts.slack ?? {};
  const preprocessed = preprocessPlanMarkdown(raw);
  let html = md.render(preprocessed);

  // Render canonical Slack mention syntax (<@U...>, <#C...|name>) as pills.
  html = renderMentionPills(html, directory);

  // Convert bare #channel-name references to Slack deep links. Look up the
  // channel ID via the directory; build a workspace-aware URL when possible
  // (https permalink with workspace_url, slack:// with team_id, falling back
  // to the bare-name form).
  html = html.replace(
    /(?<![<\w/&])#([a-zA-Z][\w-]{1,79})(?![^<]*>)/g,
    (_match, name: string) => {
      const ch = directory.channelByName.get(name.toLowerCase());
      const id = ch?.id;
      const url = buildChannelUrl(slackCfg, id, undefined, name);
      const titleId = id ? ` (${id})` : "";
      return `<a class="slack-channel-link" href="${escapeAttr(url)}" title="Open #${escapeAttr(name)}${escapeAttr(titleId)} in Slack">#${escapeHtml(name)}</a>`;
    }
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

  // Augment draft message blocks with action buttons (copy / edit / open in Slack / send / compose email)
  html = augmentDraftBlocks(html, drafts, {
    editable: opts.editable !== false,
    slackEnabled: opts.slackEnabled === true,
    directory,
    slack: slackCfg,
  });

  // Append a JSON island with the directory so client-side Smart Copy can do
  // mention substitution before writing to the clipboard.
  const island = renderDirectoryIsland(directory);
  if (island) html = html + "\n" + island;

  return html;
}

/**
 * Cockpit-aware entry point. Reads the plan file once and produces the full
 * bundle the cockpit view needs:
 *   - sections: typed structural decomposition for the cockpit's region rendering
 *   - draftsHtml: HTML of just the drafts H2 section, with action bars
 *     (the existing augmentDraftBlocks output, sliced to the drafts section)
 *   - fullHtml: the full augmented HTML (for the "Full markdown" collapsible)
 *   - directoryIslandHtml: the JSON island for Smart Copy on the client
 *   - raw: the file contents for compare-and-swap fingerprinting
 *   - mtimeMs: file modification time in ms
 */
export function readAndRenderPlanForCockpit(
  filePath: string,
  opts: {
    editable?: boolean;
    slackEnabled?: boolean;
    directory?: SlackDirectory;
    slack?: SlackWorkspaceConfig;
  } = {}
): {
  raw: string;
  mtimeMs: number;
  sections: PlanSection[];
  draftsHtml: string;
  fullHtml: string;
  directoryIslandHtml: string;
} | null {
  if (!existsSync(filePath)) return null;
  const raw = readFileSync(filePath, "utf-8");
  const stat = statSync(filePath);
  const mtimeMs = stat.mtimeMs;

  const sections = findPlanSections(raw);
  const directory = opts.directory ?? emptyDirectory();

  // Render the full file via the existing path; this is what the "Full
  // markdown" collapsible shows. We then slice out just the drafts H2 section
  // for the cockpit's DRAFTS region.
  const fullHtmlWithIsland = readAndRenderPlanMarkdown(filePath, opts) || "";

  // Strip the directory island from fullHtml (the cockpit appends it once at
  // the bottom of the page; we don't want it duplicated inside Full markdown).
  const islandRe = /<script id="slack-directory" type="application\/json">[\s\S]*?<\/script>/;
  const islandMatch = fullHtmlWithIsland.match(islandRe);
  const directoryIslandHtml = islandMatch ? islandMatch[0] : "";
  const fullHtml = fullHtmlWithIsland.replace(islandRe, "").trim();

  const draftsHtml = sliceDraftsHtml(fullHtml, sections);

  return {
    raw,
    mtimeMs,
    sections,
    draftsHtml,
    fullHtml,
    directoryIslandHtml,
  };
}

/**
 * Slice out the HTML for the drafts H2 section from the full rendered HTML.
 * Uses the section detector's H2 heading-line knowledge to find the right
 * H2 element by its text content (case-insensitive match for "draft" or
 * "unsent" prefix).
 *
 * Returns "" if no drafts section exists.
 */
function sliceDraftsHtml(fullHtml: string, sections: PlanSection[]): string {
  const draftsSection = sections.find((s) => s.kind === "drafts");
  if (!draftsSection) return "";

  // Split the full HTML by H2 boundaries.
  const parts = fullHtml.split(/(<h2[^>]*>[\s\S]*?<\/h2>)/);
  // parts is [pre-H2-prose, H2#1, body#1, H2#2, body#2, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const headingHtml = parts[i];
    const bodyHtml = parts[i + 1] || "";
    // Strip tags from heading to compare to raw heading text.
    const headingText = headingHtml.replace(/<[^>]+>/g, "").trim();
    if (looseHeadingMatch(headingText, draftsSection.rawHeading)) {
      return headingHtml + bodyHtml;
    }
  }
  return "";
}

function looseHeadingMatch(a: string, b: string): boolean {
  // Compare on alphanumeric-only lowercase to avoid emoji and whitespace
  // differences (markdown-it strips some chars during rendering).
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return norm(a) === norm(b);
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

interface DraftActionOpts {
  draft?: DraftBlock;
  editable: boolean;
  slackEnabled: boolean;
  directory: SlackDirectory;
  slack: SlackWorkspaceConfig;
}

function renderDraftActions(
  target: SendToTarget | null,
  subject: string | undefined,
  opts: DraftActionOpts
): string {
  // Sent state: show a Sent badge + Open-thread link, suppress Copy/Edit/Send.
  if (opts.draft && opts.draft.alreadySent) {
    return renderSentBadge(opts.draft, target, opts.slack);
  }

  const parts: string[] = [];
  parts.push(
    `<button type="button" class="draft-action draft-read draft-copy" data-action="copy" aria-label="Copy draft to clipboard">Copy</button>`
  );

  if (opts.draft && opts.editable) {
    parts.push(
      `<button type="button" class="draft-action draft-read draft-edit" data-action="edit" aria-label="Edit draft">Edit</button>`
    );
  }

  // Send-to-Slack button — only when:
  //   (a) slack send is enabled (token configured),
  //   (b) the source is editable (rules out demo),
  //   (c) the parsed target is sendable via Web API
  //       (channel ref, DM channel ID, user ID, or thread on any of those).
  const sendable = opts.slackEnabled && opts.editable && isSendable(target, opts.directory);
  if (opts.draft && sendable) {
    parts.push(
      `<button type="button" class="draft-action draft-read draft-send" data-action="send" aria-label="Send to Slack">Send to Slack</button>`
    );
  }

  if (target) {
    if (target.kind === "slack-channel" && target.channelName) {
      // target.channelId is populated upstream when the directory has a match.
      const url = buildChannelUrl(opts.slack, target.channelId, undefined, target.channelName);
      parts.push(
        `<a class="draft-action draft-read draft-slack" href="${escapeAttr(url)}">Open #${escapeAttr(target.channelName)} in Slack</a>`
      );
    } else if (target.kind === "slack-dm" && target.channelId) {
      const url = buildChannelUrl(opts.slack, target.channelId);
      parts.push(
        `<a class="draft-action draft-read draft-slack" href="${escapeAttr(url)}">Open DM in Slack</a>`
      );
    } else if (target.kind === "slack-user" && target.userId) {
      const url = buildUserDmUrl(opts.slack, target.userId);
      parts.push(
        `<a class="draft-action draft-read draft-slack" href="${escapeAttr(url)}">Open DM in Slack</a>`
      );
    } else if (target.kind === "slack-thread" && (target.channelId || target.userId)) {
      const idForUrl = target.channelId || target.userId!;
      const url = buildChannelUrl(opts.slack, idForUrl, target.threadTs);
      parts.push(
        `<a class="draft-action draft-read draft-slack" href="${escapeAttr(url)}">Open thread in Slack</a>`
      );
    } else if (target.kind === "email" && target.email) {
      // Body is filled client-side from the message element; href has subject only as a fallback.
      const fallbackHref =
        `mailto:${encodeURIComponent(target.email)}` +
        (subject ? `?subject=${encodeURIComponent(subject)}` : "");
      parts.push(
        `<a class="draft-action draft-read draft-email" href="${escapeAttr(fallbackHref)}" data-action="email" data-email="${escapeAttr(target.email)}" data-subject="${escapeAttr(subject || "")}">Compose email</a>`
      );
    }
  }

  // Edit-mode buttons (hidden by default; revealed when .draft-actions has the
  // `data-mode="editing"` attribute set by JS on Edit click).
  if (opts.draft && opts.editable) {
    parts.push(
      `<button type="button" class="draft-action draft-edit-only draft-save" data-action="save">Save</button>`,
      `<button type="button" class="draft-action draft-edit-only draft-cancel" data-action="cancel">Cancel</button>`,
      `<span class="draft-edit-only draft-status" role="status" aria-live="polite"></span>`
    );
  }

  // Send-mode status slot (revealed during send). Re-uses the .draft-status
  // styling but lives outside the edit-only group so it persists across mode
  // transitions.
  if (opts.draft && sendable) {
    parts.push(
      `<span class="draft-send-status" role="status" aria-live="polite"></span>`
    );
  }

  const datasetParts: string[] = [];
  if (opts.draft) {
    datasetParts.push(`data-draft-index="${opts.draft.index}"`);
    datasetParts.push(`data-draft-kind="${opts.draft.kind}"`);
    if (opts.editable) datasetParts.push(`data-editable="true"`);
    if (sendable) datasetParts.push(`data-sendable="true"`);
    if (target) {
      datasetParts.push(`data-target-kind="${target.kind}"`);
      if (target.channelName) datasetParts.push(`data-target-channel-name="${escapeAttr(target.channelName)}"`);
      if (target.channelId) datasetParts.push(`data-target-channel-id="${escapeAttr(target.channelId)}"`);
      if (target.userId) datasetParts.push(`data-target-user-id="${escapeAttr(target.userId)}"`);
      if (target.threadTs) datasetParts.push(`data-target-thread-ts="${escapeAttr(target.threadTs)}"`);
    }
    // Original body text for compare-and-swap on save.
    datasetParts.push(`data-original-text="${escapeAttr(opts.draft.bodyText)}"`);
  }
  const dataset = datasetParts.length ? " " + datasetParts.join(" ") : "";

  return `<div class="draft-actions" role="group" aria-label="Draft actions"${dataset}>${parts.join("")}</div>`;
}

function renderSentBadge(
  draft: DraftBlock,
  target: SendToTarget | null,
  slack: SlackWorkspaceConfig
): string {
  const parts: string[] = [];
  const when = draft.sentAt ? ` ${escapeHtml(draft.sentAt)}` : "";
  parts.push(`<span class="draft-action draft-sent-badge" aria-label="Sent">Sent${when}</span>`);

  if (draft.sentPermalink) {
    parts.push(
      `<a class="draft-action draft-sent-link" href="${escapeAttr(draft.sentPermalink)}" target="_blank" rel="noopener">View in Slack</a>`
    );
  } else if (target && draft.sentTs) {
    const idForUrl = target.channelId || target.userId;
    if (idForUrl) {
      const url = buildChannelUrl(slack, idForUrl, draft.sentTs);
      parts.push(
        `<a class="draft-action draft-sent-link" href="${escapeAttr(url)}">Open in Slack</a>`
      );
    }
  }
  return `<div class="draft-actions draft-actions-sent" role="group" aria-label="Sent draft" data-sent="true">${parts.join("")}</div>`;
}

function isSendable(target: SendToTarget | null, dir: SlackDirectory): boolean {
  if (!target) return false;
  if (target.kind === "slack-channel" && target.channelName) {
    // Sendable via API only if we can resolve the channel name to an ID.
    return dir.channelByName.has(target.channelName.toLowerCase());
  }
  if (target.kind === "slack-dm") return !!target.channelId;
  if (target.kind === "slack-user") return !!target.userId;
  if (target.kind === "slack-thread") return !!(target.channelId || target.userId);
  return false;
}

/**
 * Walk the rendered HTML, find draft sections (heading-bounded sections that contain a
 * `<strong>Send to:</strong>` paragraph), and append an action bar after the first
 * message container (fenced code block or blockquote) following that paragraph.
 *
 * Conservative by design: only the first message container per section is augmented,
 * and a section without a Send-to/Channel marker is left untouched.
 *
 * The pre-scanned `drafts` array (from findDraftBlocks on the same source) is consumed
 * in document order so each augmented section is paired with its DraftBlock metadata
 * for the Edit button. If a section doesn't have a corresponding draft (because the
 * pre-scan disagreed — e.g., the strikethrough-fence preprocessor diverged from the
 * raw source), the action bar still renders Copy + Slack/Email but no Edit button.
 */
function augmentDraftBlocks(
  html: string,
  drafts: DraftBlock[],
  opts: { editable: boolean; slackEnabled: boolean; directory: SlackDirectory; slack: SlackWorkspaceConfig }
): string {
  const sections = html.split(/(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/);
  let draftCursor = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    if (!section || /^<h[1-6]/.test(section)) continue;

    const sendToRegex = /<p>\s*<strong>(?:Send to|Channel):?<\/strong>([\s\S]*?)<\/p>/i;
    const sendToMatch = section.match(sendToRegex);
    if (!sendToMatch || sendToMatch.index === undefined) continue;

    const target = parseSendTo(sendToMatch[1]);
    if (target && target.kind === "slack-channel" && target.channelName) {
      const ch = opts.directory.channelByName.get(target.channelName.toLowerCase());
      if (ch) target.channelId = ch.id;
    }

    const subjectMatch = section.match(/<p>\s*<strong>Subject:?<\/strong>([\s\S]*?)<\/p>/i);
    const subject = subjectMatch
      ? decodeEntities(subjectMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
      : undefined;

    const sendToEnd = sendToMatch.index + sendToMatch[0].length;
    const before = section.slice(0, sendToEnd);
    const after = section.slice(sendToEnd);

    let augmented = false;
    const newAfter = after.replace(
      /(<pre><code[^>]*>[\s\S]*?<\/code><\/pre>|<blockquote>[\s\S]*?<\/blockquote>)/,
      (match) => {
        if (augmented) return match;
        augmented = true;
        const draft = drafts[draftCursor];
        const actionsHtml = renderDraftActions(target, subject, {
          draft,
          editable: opts.editable,
          slackEnabled: opts.slackEnabled,
          directory: opts.directory,
          slack: opts.slack,
        });
        // For sent drafts: ALSO mark the body as sent visually (CSS picks up
        // the data-sent attribute on the parent and styles the preceding
        // pre/blockquote).
        if (draft?.alreadySent) {
          // Wrap in a sent-state container so CSS can style the body.
          return `<div class="draft-sent-body">${match}</div>${actionsHtml}`;
        }
        return match + actionsHtml;
      }
    );

    if (augmented) draftCursor++;

    sections[i] = before + newAfter;
  }

  return sections.join("");
}

/**
 * Render a JSON island carrying the source's Slack directory so the client-side
 * Smart Copy and Send handlers can resolve display names to canonical mention
 * syntax without a server round-trip per draft.
 *
 * Inside a `<script type="application/json">` tag, the browser does NOT do
 * HTML entity decoding — the content is read as-is by `.textContent`. The only
 * sequences we must guard against are those that could close the surrounding
 * script tag prematurely or be interpreted as HTML comment/CDATA boundaries.
 */
export function renderDirectoryIsland(directory: SlackDirectory): string {
  if (directory.users.length === 0 && directory.channels.length === 0) return "";
  const payload = {
    users: directory.users.map((u) => ({ id: u.id, name: u.name, aliases: u.aliases || [] })),
    channels: directory.channels.map((c) => ({ id: c.id, name: c.name })),
  };
  const json = JSON.stringify(payload)
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
  return `<script id="slack-directory" type="application/json">${json}</script>`;
}
