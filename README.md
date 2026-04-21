# Synthesis Console

Local-first, open-source tooling for synthesis engineering. Renders your project management YAML and markdown files as browsable, searchable pages in a web browser.

Read the full story: [Synthesis Console: open-source tooling for synthesis engineering](https://synthesiscoding.org/articles/synthesis-console-open-source-tooling-for-synthesis-engineering/)

![Synthesis Console](screenshots/dashboard.png)

## What Is This?

If you practice synthesis engineering — managing projects through structured markdown and YAML conventions — you accumulate files: project indexes, working context documents, reference files, session archives, lessons learned. These files are the working memory of your practice. But browsing them means reading raw files in a text editor or asking your AI agent to parse them.

Synthesis Console renders those files as a browsable console. Project list with status badges and tag filtering. Project detail with rendered markdown. Session history. Lessons learned. All from the files you already have, with no import step and no database.

Synthesis engineering is a discipline for structured human-AI collaboration — like agile or Scrum, but for AI-native workflows. This console is one open-source implementation of the tooling layer. Others can build their own.

## Screenshots

**Project list** — grouped by status with color-coded badges, search, and filter toggles:

![Project list with status badges and filters](screenshots/dashboard.png)

**Status filtering** — click status toggles to show specific groups:

![Filtered to active projects](screenshots/filtered.png)

**Project detail** — metadata sidebar with rendered CONTEXT.md and REFERENCE.md:

![Project detail view](screenshots/project-detail.png)

**Lessons** — cross-project lessons learned, date-sorted:

![Lessons list](screenshots/lessons.png)

**Daily plans** — calendar navigation with today highlighted, click any date to view:

![Daily plans calendar](screenshots/plans-calendar.png)

**Plan detail** — rendered daily plan with draft message notice and grounding:

![Plan detail with draft notice](screenshots/plan-detail.png)

## Quick Start

```bash
# Install Bun (if needed)
curl -fsSL https://bun.sh/install | bash

# Clone and run
git clone https://github.com/rajivpant/synthesis-console.git
cd synthesis-console
bun install

# Try with sample data first
bun run demo

# Then with your own data
bun run start
```

Open http://localhost:5555 in your browser.

## Configuration

Create `~/.synthesis/console.yaml`:

```yaml
workspaces:
  - name: personal
    root: ~/workspaces/personal
    knowledge: ai-knowledge-personal
  - name: team
    root: ~/workspaces/team
    knowledge: ai-knowledge-team
port: 5555
```

Each workspace points to a directory containing an `ai-knowledge-*` repo with a `projects/index.yaml` file.

**Auto-detection:** If no config file exists, the console scans `~/workspaces/*/` for directories matching `ai-knowledge-*` and uses them automatically.

**Port:** Defaults to 5555. If the port is busy, automatically increments (5556, 5557, ...) and tells you which port it found.

**Portability:** Uses `~/` in paths, so the same config file works across machines with different usernames.

## Auto-start on Login

Once you're using the console daily, have it start automatically when you log in. Installed and managed per-user — no root, no system-wide changes.

### macOS (launchd)

```bash
bun run autostart:install
```

Writes a LaunchAgent plist to `~/Library/LaunchAgents/org.synthesisengineering.console.plist`, loads it, and starts the server. Logs go to `~/Library/Logs/synthesis-console/`.

Uninstall:

```bash
bun run autostart:uninstall
```

### Linux (systemd user unit)

```bash
bun run autostart:install
```

Writes a user service to `~/.config/systemd/user/synthesis-console.service`, enables it, and starts it. Logs go through journald:

```bash
journalctl --user -u synthesis-console -f
```

The service runs while you're logged in. To keep it running across logouts, run `loginctl enable-linger "$USER"` once.

Uninstall:

```bash
bun run autostart:uninstall
```

### Windows

Not yet scripted. Two options until then:

- **WSL:** clone the repo inside WSL and use the Linux script.
- **Native:** create a Task Scheduler entry that runs `bun run src/index.ts` from the repo directory at logon. A PR adding a PowerShell installer is welcome.

### What the installer does

The install scripts are shell files in `scripts/` — readable and short. They:

1. Locate your `bun` binary and bake its absolute path into the unit (no PATH surprises at boot).
2. Resolve the repo root from the script's own location, so it works wherever you clone.
3. Set up log paths (`~/Library/Logs/` on macOS, journald on Linux).
4. Restart on crash with a throttle (no hot-loop if the server fails at startup).
5. Are idempotent — re-running regenerates the unit file and reloads.

The server runs on its usual port (5555 by default, auto-incrementing if busy). Open `http://localhost:5555` any time.

## Demo Mode

Demo mode runs the console with bundled sample data — 18 projects across all 7 statuses, plus sample lessons. Three ways to activate:

```bash
bun run demo              # Explicit
bun run start -- --demo   # Flag
# Or just run without config — auto-detects and falls back to demo
```

Demo mode serves three audiences:

1. **You** — take screenshots and write documentation without exposing real project data
2. **First-time users** — evaluate the tool immediately without setting up a workspace
3. **The demo data itself** — serves as documentation-by-example of synthesis project management conventions

A "DEMO" badge in the header makes it clear when you're viewing sample data.

## How It Works

**Runtime:** [Bun](https://bun.sh) — fast JavaScript/TypeScript runtime with built-in TypeScript support.

**Framework:** [Hono](https://hono.dev) — lightweight web framework (~14KB) that also runs on Node.js and Deno.

**Rendering:** Server-side HTML via TypeScript template literal functions. No React, no Vue, no client-side framework, no build step.

**Dependencies:** Three runtime packages total.

| Package | Purpose |
|---------|---------|
| `hono` | HTTP routing and request handling |
| `js-yaml` | Parse project index YAML |
| `marked` | Render markdown to HTML |

**How requests work:** Every page load reads files from disk, parses them, and returns rendered HTML. No caching, no database. Edit a markdown file, refresh the browser, see the change.

## Project Management Conventions

The console renders files that follow synthesis project management conventions:

**`projects/index.yaml`** — the master project index:

```yaml
projects:
  - id: my-project
    name: "My Project — A Brief Description"
    status: active          # active | new | paused | ongoing | completed | archived | superseded
    started_date: 2026-01-15
    description: >
      What this project does and why it exists.
    tags:
      - infrastructure
      - tooling
    related:
      - other-project-id
    last_session: "2026-04-12"
```

**`projects/{id}/CONTEXT.md`** — working memory for each project (current state, next steps). Budget: 150 lines.

**`projects/{id}/REFERENCE.md`** — stable facts (architecture, URLs, team). Updated in place.

**`projects/{id}/sessions/YYYY-MM.md`** — session archives, append-only monthly files.

**`projects/_lessons/YYYY-MM-DD-slug.md`** — cross-project lessons learned.

**`projects/_daily-plans/YYYY-MM-DD.md`** — daily action plans with prioritized tasks, draft messages, and delegation tracking.

## Daily Plans

The daily plan viewer treats you as one person with one plan per day — regardless of how many workspaces, organizations, or roles you have. Your personal workspace holds your daily plans; the other workspaces hold their projects. The same way a GitHub account is one identity across multiple organizations, your daily plan is one view across all your work.

Plans include draft messages with grounding — each draft shows the research behind it (code commits, test results, Slack threads, deployment status). A visible notice reminds you to review and personalize each draft before sending. The tool does the research; the human adds judgment, timing, and voice.

## The Full System

Synthesis Console is the viewing layer. The methodology that produces the files it renders comes from [synthesis skills](https://github.com/rajivpant/synthesis-skills) — a library of open-source agent skills for project management, context lifecycle, daily planning, code review, and more.

To use the complete system:

```bash
# Install the skills (works with Claude Code, Cursor, Codex CLI, and 40+ other agents)
npx skills add rajivpant/synthesis-skills --global --all --copy
```

The skills create and maintain the files. The console renders them. Together they form a complete synthesis engineering workflow.

**Learn more:**
- [Synthesis Skills: Install Methodology Into Your AI Workflow](https://rajiv.com/blog/2026/03/18/synthesis-skills-install-methodology-into-your-ai-workflow/)
- [AI-Native Project Management](https://rajiv.com/blog/2025/12/14/ai-native-project-management/)
- [The Tiered Context Architecture](https://rajiv.com/blog/2026/03/01/tiered-context-architecture/)

## Security

Synthesis Console is a **local-only tool** that binds to `localhost`. It reads your own files from your own filesystem.

- **Path traversal:** URL parameters are sanitized to prevent directory traversal attacks
- **XSS:** User-provided data is escaped in HTML output; interactive elements use event delegation instead of inline handlers
- **Markdown HTML:** Rendered without sanitization (deliberate — this is a local tool reading your own files; sanitizing would break legitimate HTML in markdown)

## Contributing

Contributions welcome. Fork, branch, PR.

See [CLAUDE.md](CLAUDE.md) for development conventions if you use Claude Code.

```bash
bun run dev    # Dev mode with file watching
bun run demo   # Run with sample data
```

## License

[Apache 2.0](LICENSE)

---

Built by [Rajiv Pant](https://rajiv.com). Part of the [synthesis engineering](https://synthesisengineering.org) ecosystem.
