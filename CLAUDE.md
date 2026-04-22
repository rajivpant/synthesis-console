# synthesis-console

Local dashboard for synthesis engineering. Renders markdown and YAML project management files as browsable, searchable pages in a web browser.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono (server-side rendering)
- **Dependencies:** hono, js-yaml, markdown-it (three packages total)
- **Styling:** Pico CSS (classless) + custom CSS for status and source badges

## Architecture

- Server-side rendered HTML via template literal functions in `src/views/`
- Routes in `src/routes/` read files from disk on every request (no caching)
- Config loaded from `~/.synthesis/console.yaml` with auto-detection fallback
- No client-side framework. Minimal JS for picker/filter interactions only.
- Shared utilities (escapeHtml, escapeAttr, sanitizePathSegment) in `src/utils.ts`
- Version imported from package.json — no hardcoded version strings

### Source composition model (v0.2+)

Config declares a list of **sources**. Each source is self-describing: a name, a root directory, and one optional sub-path field per content type (`projects_dir`, `lessons_dir`, `plans_dir`, `notes_dir`). A source contributes to a view iff its corresponding sub-path is declared. Composition is a union of any active subset of sources; selection persists in the `sc_sources` cookie.

Full rationale: `~/workspaces/rajiv/ai-knowledge-rajiv/projects/synthesis-console-build/adr-001-symmetric-sources.md`.

Abstract pattern (mechanism-vs-policy, capabilities-via-presence, source attribution): `~/workspaces/rajiv/ai-knowledge-rajiv/lessons/2026-04-22-symmetric-composable-sources.md`.

## Running

```bash
bun run dev    # dev mode with file watching
bun run start  # production mode
bun run demo   # demo mode with bundled sample data
```

## Project Structure

```
src/
  index.ts         — Entry point, Hono app setup, port auto-detection
  config.ts        — Config loader, source schema, auto-detect, path helpers
  active-sources.ts — Cookie/query/default resolution of active sources per request
  utils.ts         — Shared escapeHtml, escapeAttr, sanitizePathSegment
  routes/          — Route handlers (projects, lessons, plans). Each unions across active sources.
  parsers/         — YAML and markdown parsing
  views/           — HTML template functions (layout has multi-select picker)
public/
  style.css        — Custom styles (badges, source-badge, source-picker, layout, filters, demo banner)
demo/
  ai-knowledge-demo/ — Bundled sample data for demo mode (new layout: top-level lessons/, daily-plans/)
docs/
  layouts.md       — Alternative layout recipes for adopters
  migration-v0.2.md — v0.1 → v0.2 config migration guide
console.yaml.example — Shipped config template (sanitized; mirrors author's personal + clients layout)
screenshots/       — README screenshots (taken from demo mode)
```

## Demo Mode

Demo mode uses bundled sample data in `demo/`, declared as a source with `demo: true`. The `--demo` flag filters active sources to demo-flagged ones. The built-in demo source is auto-injected even when a user config is present, so the demo is always one pick away in the source picker.

The `demo/` directory also serves as documentation-by-example of synthesis project management conventions, and as test data for future automated tests.

## URL Structure

- `/projects` — union across active sources with source badges
- `/projects/:source/:id` — project detail (source-scoped)
- `/projects/:source/:id/sessions/:period` — session detail
- `/lessons` — union
- `/lessons/:source/:slug` — lesson detail (source-scoped)
- `/plans` — union (calendar picks first source per date; duplicates listed below)
- `/plans/:source/:date` — plan detail (source-scoped)

Query params:
- `?sources=a,b` — override cookie for this session (useful for bookmarking)
- `?source=a,b` — filter within the already-active sources (projects list only)
- `?status=`, `?tag=`, `?client=`, `?q=` — standard filters

## Security

- URL path parameters sanitized via `sanitizePathSegment()` to prevent directory traversal
- HTML output uses centralized `escapeHtml()`/`escapeAttr()` from `src/utils.ts`
- Interactive elements use event delegation (no inline onclick handlers)
- Markdown rendered without sanitization (deliberate: local-only tool, user's own files)
- Cookie is non-HttpOnly / non-Secure by design — local-only tool, no sensitive state

## Conventions

- Views are pure functions: `(data) => string` returning HTML
- Routes read from disk, parse, pass to views, return response
- All paths use `~/` expansion for portability across machines
- No React, no JSX, no build step for content
- `demoMode` boolean threaded from config through routes to views
- Source badges shown on every merged list view; detail pages breadcrumb the source
