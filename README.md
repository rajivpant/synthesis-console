# Synthesis Console

Local-first dashboard for synthesis engineering. Renders your project management YAML and markdown files as browsable, searchable pages in a web browser.

![Dashboard](screenshots/dashboard.png)

## What Is This?

If you practice synthesis engineering — managing projects through structured markdown and YAML conventions — you accumulate files: project indexes, working context documents, reference files, session archives, lessons learned. These files are the working memory of your practice. But browsing them means reading raw files in a text editor or asking your AI agent to parse them.

Synthesis Console renders those files as a dashboard. Project list with status badges and tag filtering. Project detail with rendered markdown. Session history. Lessons learned. All from the files you already have, with no import step and no database.

Synthesis engineering is a discipline for structured human-AI collaboration — like agile or Scrum, but for AI-native workflows. This console is one open-source implementation of the tooling layer. Others can build their own.

## Screenshots

**Dashboard** — projects grouped by status with color-coded badges, search, and filter toggles:

![Dashboard with status badges and filters](screenshots/dashboard.png)

**Status filtering** — click status toggles to show specific groups:

![Filtered to active projects](screenshots/filtered.png)

**Project detail** — metadata sidebar with rendered CONTEXT.md and REFERENCE.md:

![Project detail view](screenshots/project-detail.png)

**Lessons** — cross-project lessons learned, date-sorted:

![Lessons list](screenshots/lessons.png)

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
