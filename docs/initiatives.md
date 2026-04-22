# Initiatives

Initiatives are portfolio-level containers that group related projects under a single unit of work. They're optional — if you don't declare any, the projects list works exactly as it did in v0.2. If you do declare them, the console gains a portfolio view, a grouped projects layout, and per-initiative detail pages.

The mental model: **one workspace can hold 40+ projects; the useful monitoring unit is usually a cluster of 5-ish big things.** Initiatives are that cluster.

---

## Quick start

In your source's `projects/index.yaml`, add an `initiatives:` section at the top and a `initiative:` field on each project that belongs to an initiative:

```yaml
initiatives:
  - id: platform
    name: Platform & Infrastructure
    description: Core services, reliability, observability.
    status: active
    lead: Alex
    tags: [infrastructure, platform]

  - id: growth
    name: Growth Experiments
    description: Funnel optimization, activation, retention work.
    status: active
    lead: Morgan

projects:
  - id: logging-unification
    initiative: platform
    name: Unified Logging Across Services
    status: active
    ...

  - id: signup-flow-redesign
    initiative: growth
    name: Signup Flow Redesign
    status: active
    ...

  - id: one-off-thing
    # no initiative — will show in "Ungrouped"
    name: One-off housekeeping task
    status: completed
    ...
```

Reload the console. Three things happen:

1. A new **Initiatives** tab appears in the header nav.
2. The **Projects** view automatically groups by initiative (toggle available in the filter drawer).
3. Each initiative has a detail page at `/initiatives/<source>/<id>` with its member projects and recent activity.

---

## Field reference

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `id` | yes | kebab-case string | Unique within the workspace; used in URLs and the `initiative:` field on projects |
| `name` | yes | string | Display name in the UI |
| `status` | yes | enum | Same values as project status: `new`, `active`, `paused`, `ongoing`, `completed`, `archived`, `superseded` |
| `description` | no | string (multi-line OK) | Shown on the initiative card and detail page |
| `started_date` | no | `YYYY-MM-DD` | When the initiative was launched |
| `target_date` | no | `YYYY-MM-DD` | Intended wrap date |
| `completed_date` | no | `YYYY-MM-DD` | Actual wrap date (set when status becomes `completed`) |
| `lead` | no | string | Primary person responsible |
| `stakeholder` | no | string | Executive sponsor, for client-facing initiatives |
| `tags` | no | string list | Cross-cutting labels; reuses the project tag vocabulary |
| `related` | no | initiative-id list | Other initiatives this one relates to (same workspace) |
| `links` | no | map | Arbitrary key-value URLs (e.g., `slack: "#channel"`, `github: "https://..."`) |

The only required fields are `id`, `name`, and `status`. Everything else is optional.

---

## The five-initiative rule of thumb

Target ≤5 initiatives per workspace. This isn't a hard limit enforced in code; it's a curation discipline. A few rationales:

- **Human working memory.** Five is around the human-comfortable upper bound for "what are the big things I'm working on right now?" Beyond that, the portfolio loses its at-a-glance property.
- **Curation not clustering.** Initiatives are deliberate, not inferred. If you have 12 natural clusters, you probably have 12 projects that want to become initiatives — re-cluster, or accept that this workspace is doing too many things.
- **Signal of scope creep.** When a workspace creeps toward 8-10 initiatives, that's a prompt to ask "is this really one workspace?" Maybe it should split.

For the author's own setup: the personal workspace has 5 initiatives covering 80 projects; the McClatchy client workspace (when fully populated) will have ~5 covering ~30. That ratio feels about right.

---

## Status: declared, not computed

An initiative's status is a **manual declaration**, not an aggregate of its member projects. An initiative can be `paused` while its member projects are `active` (strategic pause at the portfolio level). It can be `active` with zero in-progress member projects (planning phase). It can be `completed` while one member project remains `active` (wrap-up work).

This is deliberate: computed rollups feel authoritative but can mislead. The portfolio owner's judgment is the source of truth for initiative status.

If you want the member projects' aggregate at a glance, the initiative detail page shows a rollup of project counts by status.

---

## "Ungrouped" projects

Projects without an `initiative:` field show up in an **Ungrouped** section on both the initiatives list and the grouped projects view. This is by design — it makes orphans visible rather than silently hidden.

Three legitimate reasons a project might stay Ungrouped:

1. **It's genuinely one-off.** A small experiment, a side errand, something that doesn't fit any initiative and doesn't justify creating one.
2. **It will migrate to a different workspace.** Workspace-scoped projects currently living in a cross-workspace repo sometimes sit ungrouped until their real home is ready.
3. **You haven't gotten around to it yet.** That's fine; the visibility is the prompt.

---

## AI-assisted initiative authoring

Initiatives are curated by the user, but AI helps with:

- **Bootstrap suggestion.** When seeding initiatives for a workspace with many projects, ask your agent to read the project index and propose 3-5 groupings with draft names, descriptions, and member lists. Review, edit, commit.
- **New-project assignment.** When you add a new project, ask your agent to suggest which initiative it likely belongs to based on its tags, description, and `related:` entries.
- **Narrative status rollup.** Ask your agent to compose a weekly "what's happening across \<initiative\>?" narrative from the member projects' recent session files and daily plans. Useful for executive updates or weekly reviews.

These are authoring aids, not runtime features — the console renders the YAML deterministically; AI touches the YAML or composes derivative content on demand.

---

## URL structure

| Path | Shows |
|------|-------|
| `/initiatives` | All initiatives across active sources, grouped by source when more than one |
| `/initiatives/<source>/<id>` | Single initiative: description, metadata, member projects by status, recent session activity |
| `/projects` | All projects; grouped by initiative by default when initiatives exist |
| `/projects?group=status` | Force the flat-by-status view |
| `/projects?group=initiative` | Force the grouped-by-initiative view |
| `/projects?initiative=<id>` | Filter to one initiative's members |
| `/projects?initiative=_ungrouped` | Filter to Ungrouped projects only |

The user's grouping preference for `/projects` is remembered in the URL (via `?group=`). Selection across sources remains cookie-backed from v0.2.

---

## Migration from v0.2

No action required. v0.2 configs continue to work; the initiatives view simply shows "no initiatives declared" until you add an `initiatives:` section.

Adding initiatives later is additive and non-breaking: projects that don't claim membership land in Ungrouped, which is visible and fine.

---

## When initiatives do *not* help

If your workspace has fewer than ~10 projects, initiatives are overhead. The flat list is already comfortable. Skip them.

If your projects are all equally weighted tasks with no natural clustering (e.g., a bug backlog), initiatives force artificial structure. Leave them absent.

Initiatives earn their keep when projects have a natural portfolio shape — product lines, scrum teams, long-running programs — and when that shape is stable over months, not days.
