/**
 * Slack URL builder.
 *
 * Slack supports two link forms with very different reliability characteristics:
 *
 * 1. `https://<workspace>.slack.com/archives/<channelId>[/p<ts-no-dot>][?thread_ts=...]`
 *    — Permalink form. Always lands on the right channel/thread because the
 *    workspace, channel, and message are fully addressed. Browser opens the
 *    URL, then redirects to Slack desktop if installed.
 *
 * 2. `slack://channel?team=<teamId>&id=<channelId>[&message=<ts>]`
 *    — Native protocol. Opens Slack desktop directly. Reliable IF team and id
 *    are both present. With empty team= or empty id=, Slack often opens
 *    "wherever was last viewed" rather than navigating — which is the bug
 *    Rajiv hit clicking links like `slack://channel?team=&id=&name=foo`.
 *
 * Strategy: when `workspace_url` is configured, prefer the https permalink
 * form. When only `team_id` is configured, use the slack:// form with the
 * team ID populated. Without either, fall back to the bare slack:// name form
 * — which is unreliable but at least documents the user's intent.
 */

export interface SlackWorkspaceConfig {
  workspace_url?: string;
  team_id?: string;
}

/**
 * Build a Slack URL that opens a channel (and optionally a specific message
 * inside that channel).
 *
 * - channelId: required for any reliable URL (C..., D..., G...)
 * - messageTs: optional; when present, the URL navigates to that message
 *   (and Slack's renderer auto-opens the thread sidebar if the message is a
 *   thread parent or reply).
 * - displayName: only used as a last-resort fallback when channelId is empty.
 */
export function buildChannelUrl(
  cfg: SlackWorkspaceConfig,
  channelId: string | undefined,
  messageTs?: string,
  displayName?: string
): string {
  if (channelId && cfg.workspace_url) {
    const base = `https://${cfg.workspace_url.replace(/^https?:\/\//, "")}/archives/${encodeURIComponent(channelId)}`;
    if (messageTs) {
      const tsNoDot = messageTs.replace(".", "");
      return `${base}/p${tsNoDot}?thread_ts=${encodeURIComponent(messageTs)}&cid=${encodeURIComponent(channelId)}`;
    }
    return base;
  }
  if (channelId && cfg.team_id) {
    let url = `slack://channel?team=${encodeURIComponent(cfg.team_id)}&id=${encodeURIComponent(channelId)}`;
    if (messageTs) url += `&message=${encodeURIComponent(messageTs)}`;
    return url;
  }
  if (channelId) {
    let url = `slack://channel?team=&id=${encodeURIComponent(channelId)}`;
    if (messageTs) url += `&message=${encodeURIComponent(messageTs)}`;
    return url;
  }
  // No channel ID; this URL is unreliable but at least carries the intent.
  return `slack://channel?team=&id=&name=${encodeURIComponent(displayName || "")}`;
}

/**
 * Build a URL that opens a DM with a specific user. When the user's DM
 * channel ID (D...) is known, prefer the permalink form. Otherwise use the
 * `slack://user?id=...` form which Slack resolves by opening (or starting)
 * a DM with that user in the current workspace.
 */
export function buildUserDmUrl(
  cfg: SlackWorkspaceConfig,
  userId: string,
  dmChannelId?: string,
  messageTs?: string
): string {
  if (dmChannelId) {
    return buildChannelUrl(cfg, dmChannelId, messageTs);
  }
  if (cfg.team_id) {
    return `slack://user?team=${encodeURIComponent(cfg.team_id)}&id=${encodeURIComponent(userId)}`;
  }
  return `slack://user?id=${encodeURIComponent(userId)}`;
}
