/**
 * Direct Slack send via the Web API.
 *
 * This module makes Web API requests using a user OAuth token (xoxp-...) read
 * from a per-source environment variable. The token belongs to the user
 * configuring the console; the messages it sends appear in Slack as if the
 * user had typed them directly. There is no third-party tag, no "Sent via"
 * attribution, and no MCP intermediary — synthesis-console talks directly to
 * slack.com/api over HTTPS.
 *
 * Why direct API instead of Anthropic's hosted Slack MCP:
 * - The MCP tags every message "Sent using Claude" because the connector is
 *   invoked by an LLM. synthesis-console is user-driven (a human clicks
 *   Send), so that attribution would be misleading.
 * - The MCP requires the LLM to be the agent making the request; we want the
 *   request originator to be the user's own Slack identity, with no LLM in
 *   the loop at the moment of sending.
 *
 * Required Slack scopes (user token):
 *   - chat:write          — post messages
 *   - channels:read       — resolve channel IDs by name (optional)
 *   - groups:read         — same for private channels
 *   - im:read, mpim:read  — same for DMs
 *   - users:read          — resolve user IDs (optional, used for the directory)
 */

export interface SlackSendTarget {
  /** Channel ID (C... for public, G... for private) or DM ID (D...) or user ID (U... — Slack opens DM). */
  channel: string;
  /** Optional thread parent message TS — present means "reply in thread." */
  thread_ts?: string;
}

export interface SlackSendResult {
  ok: boolean;
  ts?: string;
  channel?: string;
  permalink?: string;
  error?: string;
}

const POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const PERMALINK_URL = "https://slack.com/api/chat.getPermalink";
const CONVERSATIONS_OPEN_URL = "https://slack.com/api/conversations.open";

/**
 * Post a message via Slack's Web API. Returns the message TS and permalink on
 * success, or an error string on failure.
 *
 * Behavior:
 * - If `target.channel` is a user ID (U...), opens a DM via conversations.open
 *   first to obtain the DM channel ID, then posts to it.
 * - Otherwise posts directly to the supplied channel ID.
 * - After a successful post, fetches the permalink for record-keeping.
 *
 * The `text` is sent verbatim. Callers should pre-resolve mentions to canonical
 * `<@U...>` / `<#C...|name>` syntax (see slack-mentions.resolveMentions). We
 * also pass `link_names: true` as a belt-and-suspenders guarantee in case
 * older Slack workspaces still need it.
 */
export async function postSlackMessage(
  token: string,
  target: SlackSendTarget,
  text: string
): Promise<SlackSendResult> {
  if (!token) return { ok: false, error: "No Slack token configured." };
  if (!target.channel) return { ok: false, error: "No target channel." };
  if (!text || text.trim().length === 0) return { ok: false, error: "Empty message body." };

  let channelForPost = target.channel;

  // If the target is a user ID, open the DM first to get the DM channel ID.
  if (/^U[A-Z0-9]+$/.test(target.channel)) {
    const open = await openDm(token, target.channel);
    if (!open.ok) {
      return { ok: false, error: open.error || "Could not open DM." };
    }
    channelForPost = open.channel!;
  }

  const body: Record<string, unknown> = {
    channel: channelForPost,
    text,
    link_names: true,
    unfurl_links: false,
    unfurl_media: false,
  };
  if (target.thread_ts) body.thread_ts = target.thread_ts;

  let res: Response;
  try {
    res = await fetch(POST_MESSAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }

  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status} from Slack.` };
  }

  let json: { ok: boolean; ts?: string; channel?: string; error?: string };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, error: "Could not parse Slack response." };
  }

  if (!json.ok) {
    return { ok: false, error: json.error || "Slack returned ok=false." };
  }

  // Fetch permalink (best-effort; failure here doesn't fail the send).
  let permalink: string | undefined;
  if (json.channel && json.ts) {
    try {
      const pres = await fetch(
        `${PERMALINK_URL}?channel=${encodeURIComponent(json.channel)}&message_ts=${encodeURIComponent(json.ts)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (pres.ok) {
        const pj = (await pres.json()) as { ok: boolean; permalink?: string };
        if (pj.ok && pj.permalink) permalink = pj.permalink;
      }
    } catch {
      // ignore — permalink is decorative
    }
  }

  return {
    ok: true,
    ts: json.ts,
    channel: json.channel,
    permalink,
  };
}

async function openDm(
  token: string,
  userId: string
): Promise<{ ok: true; channel: string } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetch(CONVERSATIONS_OPEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ users: userId }),
    });
  } catch (err) {
    return { ok: false, error: `Network error: ${(err as Error).message}` };
  }
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const json = (await res.json()) as { ok: boolean; channel?: { id: string }; error?: string };
  if (!json.ok || !json.channel) {
    return { ok: false, error: json.error || "conversations.open failed" };
  }
  return { ok: true, channel: json.channel.id };
}
