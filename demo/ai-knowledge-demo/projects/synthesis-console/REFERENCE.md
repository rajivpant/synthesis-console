# Synthesis Console — Reference

## Quick Reference

| Resource | Value |
|----------|-------|
| Product name | synthesis-console |
| Runtime | Bun |
| Framework | Hono |
| Dependencies | hono, js-yaml, marked (3 total) |
| License | Apache 2.0 |
| Default port | 5555 (auto-increments if busy) |

## Architecture

Server-side rendered HTML via TypeScript template literal functions. No client-side framework. Reads files from disk on every request — changes appear on browser refresh.

## Configuration

```yaml
# ~/.synthesis/console.yaml
workspaces:
  - name: demo
    root: ~/workspaces/demo
    knowledge: ai-knowledge-demo
port: 5555
```

## Phase Plan

| Phase | Deliverable | Status |
|-------|-------------|--------|
| 1 | Project management dashboard | Done |
| 2 | Daily action plan viewer | Planned |
| 3 | Wiki/notes viewer | Planned |
