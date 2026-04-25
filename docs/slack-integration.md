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

## Quick start (one command)

After you've created a Slack app, added the user-token scopes, installed it to your workspace, and copied the User OAuth Token (`xoxp-...`):

```bash
SLACK_USER_TOKEN_RAJIV='xoxp-...' bun run setup-slack personal
```

Replace `SLACK_USER_TOKEN_RAJIV` with whatever you put in `source.slack.user_token_env`, and `personal` with the source name. The script:

1. Calls `auth.test` to validate the token and read the workspace URL + team ID
2. Writes `workspace_url` and `team_id` into the source's `slack:` block in `~/.synthesis/console.yaml`
3. Adds (or replaces) the `export` line in `~/.zshrc` so the env var persists across shells
4. Adds the env var to the autostart LaunchAgent plist via PlistBuddy and reloads it so the running console picks it up
5. Runs `sync-slack-directory` to populate `slack-users.yaml` and `slack-channels.yaml` from the workspace

Pass any of `--no-zshrc`, `--no-plist`, `--no-sync` to skip individual steps. By default everything runs.

After it finishes, visit http://localhost:5555/plans — drafts should render mention pills, the Send-to-Slack button should appear, and Open-in-Slack links should land on the right channel.

## Multi-workspace setup

Each source can have its own `slack:` block, with its own user token, its own users/channels files, and its own workspace_url + team_id. This is the natural model for someone who works across multiple Slack workspaces (e.g. one personal + multiple clients) — each workspace gets its own Slack app, its own token, and its own directory data.

Example multi-workspace configuration:

```yaml
sources:
  - name: personal
    root: ~/workspaces/rajiv/ai-knowledge-rajiv
    plans_dir: daily-plans
    slack:
      workspace_url: workspace-a.slack.com
      team_id: T01ABCDEFGH
      user_token_env: SLACK_USER_TOKEN_RAJIV_WS_A
      users_file: source/contexts/slack-users.yaml
      channels_file: source/contexts/slack-channels.yaml

  - name: client-b
    root: ~/workspaces/client-b/ai-knowledge-client-b-rajiv-private
    projects_dir: projects
    slack:
      workspace_url: workspace-b.slack.com
      team_id: T02ZYXWVUTS
      user_token_env: SLACK_USER_TOKEN_RAJIV_WS_B
      users_file: source/contexts/slack-users.yaml
      channels_file: source/contexts/slack-channels.yaml
```

The two sources resolve mentions, channel IDs, and Send-to-Slack independently — they don't share a directory or a token. A draft on the `personal` source's daily plan that targets `#some-channel` is matched against the `personal` source's channel directory; a draft anywhere on `client-b` content uses `client-b`'s directory and posts via `client-b`'s token.

### Setup procedure for each additional workspace

For each workspace you want to integrate:

1. Create a separate Slack app for that workspace at `https://api.slack.com/apps` (each workspace's app is independent — install scopes are per-app, per-workspace).
2. Add the user-token scopes listed in the Token setup section.
3. Install to the workspace and copy the `xoxp-` token.
4. Add the source's `slack:` block to `~/.synthesis/console.yaml` with a unique `user_token_env` name (e.g. `SLACK_USER_TOKEN_RAJIV_WS_B`).
5. Run setup-slack with the appropriate token for that source:

```bash
SLACK_USER_TOKEN_RAJIV_WS_B='xoxp-...' bun run setup-slack client-b
```

The script writes the new env var to `~/.zshrc`, the LaunchAgent plist, the source's `slack:` block in console.yaml, and runs sync-slack to populate that source's users/channels files.

### Verification checklist for multi-workspace setups

- [ ] Each source's `user_token_env` points at a distinct env var name (collision means one workspace's token would overwrite another's at runtime).
- [ ] Each source's `users_file` and `channels_file` point at distinct paths (otherwise the second sync overwrites the first's data).
- [ ] Visit a daily plan on each source. Open-in-Slack URLs should use the correct per-source `workspace_url`. Mention pills should resolve to the right per-workspace display names.
- [ ] On `~/Library/LaunchAgents/...plist`, both env vars should appear under `EnvironmentVariables`. After reload, the running console picks up both.
- [ ] If both sources contribute to the merged plans view, each plan still resolves against its own source's directory (the renderer uses the source the plan came from, not a global directory).

---

## Sync only (no setup)

If `workspace_url` and `team_id` are already set and the token is already in env, just refresh the user/channel lists:

```bash
bun run sync-slack personal
bun run sync-slack personal --users-only
bun run sync-slack personal --channels-only
bun run sync-slack personal --dry-run
```

The sync writes `slack-users.yaml` and `slack-channels.yaml` with real IDs from the workspace. Existing aliases in the users file ARE preserved across sync runs; everything else is overwritten by the API.

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

The token is the most sensitive thing in this setup. The recommended path is to run `setup-slack` (described in Quick start above), which writes the token to the macOS Keychain and configures everything that needs to read it from there. The token never lands on disk in cleartext.

What `setup-slack` does for token storage:

1. **macOS Keychain** — token is stored under service name `synthesis-console-slack-<source>` (e.g. `synthesis-console-slack-personal`) with your username as the account. Encrypted at rest by the OS; not indexed by Spotlight; not included in Time Machine backups.
2. **`~/.synthesis/keychain-tokens.txt`** — a manifest mapping the Keychain service to the env-var name the console expects (`<service>:<env-var-name>`). The autostart wrapper reads this to know which tokens to fetch.
3. **`~/.zshrc`** — adds an `export` line that fetches the token from the Keychain at shell init via `security find-generic-password`. The literal token is NOT written to zshrc, only the command that reads it. So zshrc stays safe to back up, index, and share.
4. **LaunchAgent plist** — `setup-slack` updates the plist to invoke `scripts/launch.sh` (a wrapper that reads tokens from the Keychain at launch and exec's bun) instead of bun directly. No tokens land in the plist's `EnvironmentVariables`.

Manual setup (only needed if you can't or don't want to use `setup-slack`): pre-load the env var in your shell before running the console (`SLACK_USER_TOKEN_RAJIV='xoxp-...' bun run dev`). The console reads the env var at request time.

### Verify

Visit any plan with a draft. If the token is configured correctly, the draft action bar shows a **Send to Slack** button next to Copy / Edit / Open in Slack.

### Rotate the token

Slack user OAuth tokens don't expire automatically, but you might rotate one because:
- The token leaked (force-rotate immediately on `https://api.slack.com/apps/<your-app-id>/oauth` → "Reinstall to Workspace").
- You uninstalled and reinstalled the Slack app.
- You changed scopes and Slack issued a new token on reinstall.
- Routine hygiene (annual rotation, post-departure for shared workspaces, etc.).

To rotate without breaking the running console, re-run setup-slack with the new token:

```bash
SLACK_USER_TOKEN_RAJIV='xoxp-NEW...' bun run setup-slack personal
```

That single command updates all three persistence locations idempotently:
- `~/.zshrc` — replaces the existing `export SLACK_USER_TOKEN_RAJIV=...` line in place; appends a new one if it wasn't there.
- `~/Library/LaunchAgents/org.synthesisengineering.console.plist` — `EnvironmentVariables:SLACK_USER_TOKEN_RAJIV` is updated via PlistBuddy `Set` (not `Add`), so the autostart picks up the new token on reload.
- The LaunchAgent reload is automatic; the running console reads the env var per-request, so the new token takes effect on the next page load with no manual restart.

The directory files (`slack-users.yaml`, `slack-channels.yaml`) are also re-fetched as the final step in case the token's scope changed or you reinstalled to a different workspace. If you only want to rotate the token without re-syncing, pass `--no-sync`.

If you also want to rotate the token in your current shell (not just future shells), `source ~/.zshrc` after the run.

To verify the rotation took effect, hit the preflight endpoint for any draft and confirm `tokenConfigured: true`:

```bash
curl -s http://localhost:5555/plans/personal/<some-date>/draft/0/preflight | jq .tokenConfigured
```

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

- **Token storage:** macOS Keychain only (encrypted at rest by the OS; not Spotlight-indexed; not in Time Machine). zshrc holds a `security find-generic-password` command, not the token. The LaunchAgent plist invokes `scripts/launch.sh` which reads from the Keychain at launch — no token in the plist either. The console reads the env var per-request, so rotating the token via `setup-slack` takes effect on the next page load without a manual restart.
- **Local-only:** the synthesis-console binds to localhost. The send endpoint accepts requests only from the same machine.
- **Confirmation required:** the send endpoint requires `{"confirmed": true}` in the request body. The browser-side modal shows a preview of the resolved message and the target before enabling the Send button.
- **Read-only on demo sources:** sources with `demo: true` are blocked from send and edit at both the renderer (no buttons rendered) and the endpoint (HTTP 403).
- **Token scope minimization:** request only the user-token scopes you'll actually use. `chat:write` is required; everything else is optional and supports auto-discovery features that aren't needed for the basic send path.

### Directory file location

`users_file` and `channels_file` accept three forms:
- **Absolute path** (`/abs/path/file.yaml`) — used as-is. Useful for placing the directory in a sibling workspace-private repo (e.g. `/Users/me/workspaces/client/ai-knowledge-client-rajiv-private/source/contexts/slack-users.yaml`).
- **Home-relative** (`~/path/file.yaml`) — expanded to your home directory. Useful for machine-local storage (e.g. `~/.synthesis/personal/slack-users.yaml`) so the directory data never enters version control.
- **Source-root-relative** (`path/file.yaml`) — joined with `source.root`. Legacy default; convenient for sources whose root is the natural home for the data.

Workspace-specific directory data (one workspace's user list) generally belongs either in that workspace's private repo (cross-Mac sync) or in `~/.synthesis/<source>/` (machine-local; regenerated by `sync-slack` on each Mac). Using the cross-workspace personal repo for workspace-specific data is discouraged; gitignore those files if you can't relocate immediately.
