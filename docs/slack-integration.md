# Slack integration (v0.6+)

Daily-plan drafts in synthesis-console can do four things with Slack:

1. **Render canonical mention syntax (`<@U...>`, `<#C...|name>`) as visible pills** in the page so you can see at a glance which tokens will trigger a Slack notification before sending.
2. **Smart Copy** — rewrites display-form `@Name` and `#channel` references to canonical Slack syntax in the clipboard, so paste-and-send in Slack resolves mentions correctly.
3. **Open in Slack** with reliable URLs — uses your workspace permalink form (`https://<workspace>.slack.com/archives/<channelId>`) when configured, instead of the bare-name `slack://` deeplink that often lands on the wrong channel.
4. **Send to Slack** — direct POST via Slack's Web API using your own user OAuth token (`xoxp-...`). The message is sent as you, with no third-party tag, no MCP intermediary. After a successful send, the daily-plan file is annotated with a `**Sent:**` marker and the draft renders in a sent state on reload.

All four are opt-in. With no `slack:` config, drafts continue to work in the v0.4/v0.5 mode (Copy, Edit, Open in Slack with the legacy bare-name link, Compose email).

---

## Why direct API instead of Anthropic's hosted Slack MCP

The Anthropic Slack MCP connector tags every message it sends with "Sent using Claude" because the connector is invoked by an LLM. That tag is appropriate when an agent autonomously decides to post — it tells recipients an LLM is on the other end of the conversation.

synthesis-console is user-driven: a human reviews the draft, edits it, and clicks Send. There is no LLM in the loop at the moment of sending. Tagging those messages "Sent using Claude" would be misleading. So synthesis-console does not use the Anthropic MCP — it talks to `slack.com/api/chat.postMessage` directly, authenticated with your own user OAuth token. The message reaches Slack with your identity attached and no extra metadata.

If you want LLM-mediated send (where an agent decides what to send and to whom), use the Anthropic Slack MCP for that path — it's the right tool for that workflow. synthesis-console handles the user-driven path.

---

## Quick start

After creating a Slack app and exporting the `xoxp-` token (see Token setup below):

```bash
# Populate the directory files from your real workspace.
bun run sync-slack personal

# Or just one of the two:
bun run sync-slack personal --users-only
bun run sync-slack personal --channels-only

# See what would change without writing:
bun run sync-slack personal --dry-run
```

The sync script writes `slack-users.yaml` and `slack-channels.yaml` with real IDs from the workspace, replacing any placeholders. Existing aliases in the users file ARE preserved across sync runs; everything else is overwritten by the API. Re-run any time the team or channel list changes.

---

## Configuration

Per-source `slack:` block in `~/.synthesis/console.yaml`:

```yaml
sources:
  - name: personal
    root: ~/workspaces/rajiv/ai-knowledge-rajiv
    plans_dir: daily-plans
    slack:
      workspace_url: rajivpant.slack.com    # used to build https permalinks
      team_id: T01234567                    # used by slack:// fallback
      user_token_env: SLACK_USER_TOKEN_RAJIV  # name of env var (token NOT in YAML)
      users_file: source/contexts/slack-users.yaml
      channels_file: source/contexts/slack-channels.yaml
```

Every field is optional. Behavior:

- Without `users_file` and `channels_file`: no mention pills, no Smart Copy substitution. Mentions render as raw text.
- Without `workspace_url` and `team_id`: Open-in-Slack falls back to the bare slack:// form (which can land on the wrong channel — recommend setting at least `team_id`).
- Without `user_token_env` (or env var unset): Send-to-Slack button is hidden. Copy and Open-in-Slack still work.

---

## Token setup

You need a **user** OAuth token (`xoxp-...`), not a bot token (`xoxb-...`). Bot tokens send as the bot identity, which would put the bot's name on every message. User tokens send as you.

### Create a Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From scratch**.
2. Pick a name (e.g., `synthesis-console-rajiv`) and the workspace you want to post to.
3. **OAuth & Permissions** → scroll to **User Token Scopes** and add:
   - `chat:write` — post messages
   - `channels:read` — resolve public channel IDs (for `conversations.list` if you want to auto-build the channels file)
   - `groups:read` — same for private channels
   - `im:read`, `mpim:read` — for direct messages
   - `users:read` — for the directory (auto-build users file)
4. Click **Install to Workspace** at the top of the OAuth page.
5. Approve the scopes.
6. Copy the **User OAuth Token** (starts with `xoxp-...`).

### Store the token

The token is the most sensitive thing in this setup. Do NOT put it in the YAML config — it would be world-readable and you'd risk committing it. Instead, store it in an environment variable named whatever you put in `slack.user_token_env`:

```bash
# In ~/.zshrc or ~/.bashrc:
export SLACK_USER_TOKEN_RAJIV='xoxp-...'
```

Restart the synthesis-console process after setting the env var. The console reads the env var at request time, so updates take effect on the next request.

### Verify

Visit any plan with a draft. If the token is configured correctly, the draft action bar shows a **Send to Slack** button next to Copy / Edit / Open in Slack.

---

## Directory files

### `slack-users.yaml`

Maps display names and aliases to Slack user IDs. Used by:
- Mention pill rendering — `<@U...>` becomes a pill with the user's display name.
- Smart Copy — `@Saner` becomes `<@U0AG66Z95KM>` in the clipboard so Slack resolves it as a mention.
- Send-to-Slack — same substitution before posting.

Format:

```yaml
users:
  - name: Saner Keles
    aliases: [Saner, saner.keles]
    id: U0AG66Z95KM
  - name: Marcelo Freitas
    aliases: [Marcelo]
    id: U0AGABCDE1
```

Lookup is case-insensitive and whitespace-normalized. Long names win — `Saner Keles` matches before `Saner`.

### `slack-channels.yaml`

Maps channel names (without `#`) to channel IDs. Used by:
- The bare `#channel-name` link in plan content — links use the channel ID for reliable navigation.
- Send-to-Slack — converts a `#channel-name` Send-to target to the channel ID for `chat.postMessage`.
- Open-in-Slack on the action bar — same.

Format:

```yaml
channels:
  - name: mmc-product-growth-squad
    id: C012345ABCD
```

---

## Using mentions in drafts

Two forms work:

**Display form** — what you'd type to Slack:

```
@Saner — quick check on the failover ticket. Looping in @Marcelo.
```

The HTML view shows `@Saner` as plain text. On Copy, Smart Copy rewrites to canonical syntax. On Send, the same substitution runs server-side.

**Canonical form** — Slack's mention syntax:

```
Heads up <@U0AG66Z95KM> and <@U0AGABCDE1>: Ada County issue in <#C0AGCH1235|news-csa-feedback>.
```

The HTML view renders these as pills with the resolved display name. Smart Copy passes them through unchanged. Send sends them as-is — Slack's render layer resolves canonical syntax to mentions regardless of how the message arrived.

Use display form when authoring drafts you'd type yourself. Use canonical form when you need precision (e.g., disambiguating two people with similar names) or when the agent generating the draft already has the user IDs.

---

## Mark-as-sent

When a draft is sent successfully, synthesis-console appends a marker to the daily-plan file right after the draft body:

```
**Sent:** 2026-04-25T02:00:00.000Z (TS=1745559600.123456) https://rajivpant.slack.com/archives/C012345/p1745559600123456
```

The marker carries:
- ISO timestamp of the successful send.
- Slack message TS (used for thread permalinks).
- Permalink (browsable URL into Slack).

On the next render of the page, the parser detects the marker and:
- Strikes through the original draft body (CSS `text-decoration: line-through`).
- Replaces the action bar with a green **Sent** badge and a **View in Slack** link to the permalink.
- Suppresses Copy / Edit / Send to prevent accidental re-sends.

The marker is idempotent — the send endpoint refuses to re-send a draft that's already marked sent.

---

## Security

- **Token storage:** env var only. Never in YAML, never committed. The console reads the env var per-request, not at startup, so rotating the token takes effect on the next request without restart.
- **Local-only:** the synthesis-console binds to localhost. The send endpoint accepts requests only from the same machine.
- **Confirmation required:** the send endpoint requires `{"confirmed": true}` in the request body. The browser-side modal shows a preview of the resolved message and the target before enabling the Send button.
- **Read-only on demo sources:** sources with `demo: true` are blocked from send and edit at both the renderer (no buttons rendered) and the endpoint (HTTP 403).
- **Token scope minimization:** request only the user-token scopes you'll actually use. `chat:write` is required; everything else is optional and supports auto-discovery features that aren't needed for the basic send path.
