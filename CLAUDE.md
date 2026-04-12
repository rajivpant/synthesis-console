# synthesis-console

Local dashboard for synthesis engineering. Renders markdown and YAML project management files as browsable, searchable pages in a web browser.

## Tech Stack

- **Runtime:** Bun
- **Framework:** Hono (server-side rendering)
- **Dependencies:** hono, js-yaml, marked (three packages total)
- **Styling:** Pico CSS (classless) + custom CSS for status badges

## Architecture

- Server-side rendered HTML via template literal functions in `src/views/`
- Routes in `src/routes/` read files from disk on every request (no caching)
- Config loaded from `~/.synthesis/console.yaml` with auto-detection fallback
- No client-side framework. Minimal JS for search/filter interactions only.
- Shared utilities (escapeHtml, escapeAttr, sanitizePathSegment) in `src/utils.ts`
- Version imported from package.json — no hardcoded version strings

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
  config.ts        — Config loader, demo mode detection, auto-detect
  utils.ts         — Shared escapeHtml, escapeAttr, sanitizePathSegment
  routes/          — Route handlers (projects, lessons)
  parsers/         — YAML and markdown parsing
  views/           — HTML template functions
public/
  style.css        — Custom styles (badges, layout, filters, demo banner)
demo/
  ai-knowledge-demo/ — Bundled sample data for demo mode
screenshots/         — README screenshots (taken from demo mode)
```

## Demo Mode

Demo mode uses bundled sample data in `demo/`. Activated by `--demo` flag, `bun run demo`, or auto-fallback when no config exists. The `demo/` directory also serves as documentation-by-example of synthesis project management conventions, and as test data for future automated tests.

## Security

- URL path parameters sanitized via `sanitizePathSegment()` to prevent directory traversal
- HTML output uses centralized `escapeHtml()`/`escapeAttr()` from `src/utils.ts`
- Interactive elements use event delegation (no inline onclick handlers)
- Markdown rendered without sanitization (deliberate: local-only tool, user's own files)

## Conventions

- Views are pure functions: `(data) => string` returning HTML
- Routes read from disk, parse, pass to views, return response
- All paths use `~/` expansion for portability across machines
- No React, no JSX, no build step for content
- demoMode boolean threaded from config through routes to views
