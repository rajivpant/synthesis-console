# Migrating from v0.1 to v0.2

Synthesis Console v0.2 replaced the `workspaces:` config schema with `sources:`. This is a breaking change. v0.1 configs fail fast at startup with a migration hint; there's no silent auto-conversion.

v0.1 shipped on 2026-04-12 with a tiny user base. A clean break is simpler than silent migration.

## What changed

| Concept | v0.1 | v0.2 |
|---------|------|------|
| Config key | `workspaces:` | `sources:` |
| Path model | `{root}/{knowledge}/projects/_lessons` etc. — paths derived | Each sub-path declared explicitly (`projects_dir`, `lessons_dir`, `plans_dir`) |
| UI selection | Single-select dropdown | Multi-select picker (checkboxes) |
| URL for detail | `/projects/:id?ws=X` | `/projects/:source/:id` |
| Demo mode | Special workspace type | A source with `demo: true` |
| Composition | One workspace at a time | Union across any active subset |
| Attribution | Implicit (only one source) | Source badge on every merged row |

## 60-second migration

Your v0.1 config (single workspace):

```yaml
workspaces:
  - name: rajiv
    root: ~/workspaces/rajiv
    knowledge: ai-knowledge-rajiv

port: 5555
```

Becomes this v0.2 config:

```yaml
sources:
  - name: rajiv
    root: ~/workspaces/rajiv/ai-knowledge-rajiv  # combine root + knowledge
    projects_dir: projects
    lessons_dir: lessons                          # or projects/_lessons for legacy layout
    plans_dir: daily-plans                        # or projects/_daily-plans for legacy layout
    default_active: true                          # preselect on first run

port: 5555
```

### Step-by-step

1. **Rename the top-level key** from `workspaces:` to `sources:`.
2. **Collapse `root` + `knowledge`** into a single `root:` pointing to the combined absolute path.
3. **Add sub-path fields** for the content types your directory provides:
   - `projects_dir: projects` (if you have `projects/index.yaml`)
   - `lessons_dir: lessons` if you migrated to top-level, or `lessons_dir: projects/_lessons` for legacy.
   - `plans_dir: daily-plans` if you migrated to top-level, or `plans_dir: projects/_daily-plans` for legacy.
4. **Mark one source with `default_active: true`** so it's selected on first run.
5. Optionally add more sources for additional knowledge bases. See [layouts.md](layouts.md) for recipes.

## Adding more sources

After migrating the v0.1 workspace, add as many additional sources as you want. Each is independent:

```yaml
sources:
  - name: personal
    root: ~/knowledge/personal
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

  - name: client-a
    root: ~/clients/client-a/knowledge
    projects_dir: projects
    # no plans_dir — daily plans are person-scoped and live in personal
```

## What if I don't want to migrate

v0.2 is a clean break. Stay on v0.1 by pinning your clone to the `v0.1.0` tag. Future releases will only target v0.2+.

## Troubleshooting

- **"Source is missing required field 'name'"** — every source entry needs `name:` and `root:`.
- **"Duplicate source name"** — pick unique names across sources.
- **Paths resolve wrong** — `root:` should be an absolute path (supports `~/`). Sub-paths (`projects_dir` etc.) are relative to `root`.
- **Source not appearing in a view** — check that the directory exists and contains the expected filenames. Missing directories are silently ignored; a present but empty directory shows "no items."

See [layouts.md](layouts.md) for worked examples of the config shape.
