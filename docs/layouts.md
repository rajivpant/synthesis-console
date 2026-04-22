# Layout Recipes

Synthesis Console is opinionated about *formats* (markdown, YAML front matter, dated filenames) but not about *paths*. Each source declares its own directory structure through the `console.yaml` source schema. This page shows several layouts you can pick from or mix.

If you're looking at this for the first time, start with the **Canonical Layout** below — it's the one the author uses, and it's shipped as `console.yaml.example` in the repo. The other layouts solve specific situations that the canonical one doesn't address.

---

## The source schema, one more time

Every source declares (at minimum):

| Field | Purpose |
|-------|---------|
| `name` | Unique identifier used in URLs and the selection cookie. |
| `root` | Absolute path on disk (supports `~/`). |

And any subset of these, by presence, to declare what the source provides:

| Field | Activates the view |
|-------|--------------------|
| `projects_dir` | Projects — requires `{root}/{projects_dir}/index.yaml` |
| `lessons_dir` | Lessons — expects `YYYY-MM-DD-slug.md` filenames |
| `plans_dir` | Daily plans — expects `YYYY-MM-DD.md` filenames |
| `notes_dir` | Reserved for Phase 3 (wiki/notes viewer) |

Optional flags:

| Field | Effect |
|-------|--------|
| `display_name` | Human-readable label in the UI. |
| `default_active: true` | Pre-selected on first run (when no cookie is set). |
| `demo: true` | Marks as demo data; filtered by `--demo` flag. |

---

## Layout 1: Canonical (personal + clients)

This is how the author uses it. A single personal knowledge base that holds cross-workspace content (projects, lessons, person-scoped daily plans), plus one workspace-private repo per client that holds that client's projects.

```
~/knowledge/personal/
  projects/
    index.yaml
    project-a/
      CONTEXT.md
      REFERENCE.md
      sessions/2026-04.md
    project-b/
  lessons/
    2026-04-22-some-lesson.md
  daily-plans/
    2026-04-22.md

~/workspaces/client-a/knowledge-client-a-private/
  projects/
    index.yaml
    client-a-project-1/
  notes/  (phase 3)

~/workspaces/client-b/knowledge-client-b-private/
  projects/
    index.yaml
```

**Config:**

```yaml
sources:
  - name: personal
    root: ~/knowledge/personal
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

  - name: client-a
    root: ~/workspaces/client-a/knowledge-client-a-private
    projects_dir: projects
    notes_dir: notes

  - name: client-b
    root: ~/workspaces/client-b/knowledge-client-b-private
    projects_dir: projects
```

**When to use:** consulting/contracting with a handful of long-running client engagements; clear separation between personal and per-client work; daily plans cross all roles so they live in the personal source.

---

## Layout 2: Single Monorepo

Everything in one repo. Simplest possible setup.

```
~/knowledge/
  projects/index.yaml
  projects/my-project/CONTEXT.md
  lessons/2026-04-22-foo.md
  daily-plans/2026-04-22.md
```

**Config:**

```yaml
sources:
  - name: main
    display_name: My Knowledge
    root: ~/knowledge
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

port: 5555
```

**When to use:** solo developer or writer with a single knowledge base; no need to compose across multiple sources.

---

## Layout 3: Team-Shared + Personal Overlays

A team-shared knowledge base (read-only for individuals, shared across the team) overlaid with each person's personal notes. This is useful for engineering teams that want shared project tracking but individual lessons/plans.

```
~/team-shared/
  projects/index.yaml

~/personal/
  lessons/2026-04-22-foo.md
  daily-plans/2026-04-22.md
```

**Config:**

```yaml
sources:
  - name: team
    display_name: Team (shared)
    root: ~/team-shared
    projects_dir: projects
    default_active: true

  - name: personal
    display_name: Personal
    root: ~/personal
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

port: 5555
```

**When to use:** team lead or team member; shared source of truth for projects, personal workspace for reflections and daily planning. Both sources are default-active so you always see the full picture.

---

## Layout 4: Multi-Business (two businesses, plans per business)

Someone running two separate businesses with distinct daily plans for each. There's no personal "base" — both are peer sources.

```
~/business-a/
  projects/index.yaml
  lessons/
  daily-plans/

~/business-b/
  projects/index.yaml
  lessons/
  daily-plans/
```

**Config:**

```yaml
sources:
  - name: business-a
    display_name: Business A
    root: ~/business-a
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

  - name: business-b
    display_name: Business B
    root: ~/business-b
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: false
```

**When to use:** the "person-scoped daily plans" convention does not apply — each business has its own plans. Both sources declare `plans_dir`. The console shows both in the plans view with source badges; dates with plans in both sources appear in the calendar once and also in the "dates with plans from multiple sources" disclosure below the calendar.

---

## Layout 5: Team Lead Tracking Direct Reports

A team lead who tracks daily plans for each direct report. Each report is a peer source contributing its own plans.

```
~/team-lead/
  projects/
  lessons/
  daily-plans/      (lead's own plans)

~/reports/alice/
  daily-plans/

~/reports/bob/
  daily-plans/
```

**Config:**

```yaml
sources:
  - name: lead
    display_name: My work
    root: ~/team-lead
    projects_dir: projects
    lessons_dir: lessons
    plans_dir: daily-plans
    default_active: true

  - name: alice
    display_name: Alice
    root: ~/reports/alice
    plans_dir: daily-plans

  - name: bob
    display_name: Bob
    root: ~/reports/bob
    plans_dir: daily-plans
```

**When to use:** lead wants to browse their own work by default, and toggle on any direct report's plans when syncing. Reports' plans are not default-active; the lead adds them via the source picker as needed.

---

## Layout 6: Legacy (projects/_lessons, projects/_daily-plans)

The pre-phase-2 layout where lessons and daily plans live under `projects/`. The console still supports this via explicit sub-paths.

```
~/knowledge/
  projects/index.yaml
  projects/my-project/
  projects/_lessons/2026-04-22-foo.md
  projects/_daily-plans/2026-04-22.md
```

**Config:**

```yaml
sources:
  - name: main
    root: ~/knowledge
    projects_dir: projects
    lessons_dir: projects/_lessons
    plans_dir: projects/_daily-plans
    default_active: true
```

**When to use:** you haven't migrated to the top-level `lessons/`, `daily-plans/` convention. The console's auto-detect also recognizes this layout as a fallback if no config is present.

---

## Mixing and matching

All the layouts above are just patterns. Your real config can mix them:

- Personal (canonical) + one team-shared source
- Two businesses + a personal lessons-only source for cross-business reflections
- A team-lead layout plus a legacy personal source

The console makes no assumptions — each source declares its own paths, and the union is what you see.

---

## Debugging tips

- **My source doesn't appear in the projects view.** Check that `{root}/{projects_dir}/index.yaml` exists and parses as YAML.
- **My source doesn't appear in the lessons or plans view.** Check that the directory exists and filenames match the expected pattern (`YYYY-MM-DD-*.md` for lessons, `YYYY-MM-DD.md` for plans).
- **The picker shows all sources when I want a subset active.** First-run selection is driven by `default_active: true`. After first run, selection persists in the `sc_sources` cookie; clear it or re-select.
- **I want to share a specific view via URL.** Append `?sources=a,b` to any page URL to override the cookie for that session.

---

## Adding a new content type

Phase 3 is a wiki/notes viewer that will consume `notes_dir`. When it ships, your existing sources that already declare `notes_dir` automatically light up in the notes view — no config changes needed. The same extensibility story applies to any future content type.

If you want to experiment ahead of the notes viewer, add `notes_dir` to sources now; the field is silently ignored until Phase 3 lands.
