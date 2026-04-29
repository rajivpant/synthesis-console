# Daily Plan Cockpit View

The daily plan cockpit is the synthesis console's smart rendering for `/plans/:source/:date`. It detects typed sections from a daily plan's markdown structure and renders each as the affordance the user actually needs — a decision waits for a click, a task offers a checkbox, a draft has its action bar — instead of treating every section as uniform paragraph + list HTML.

This page describes what the cockpit recognizes, how to format your plans for the best result, and how it falls back when you don't.

---

## Why a cockpit, not a viewer

A typical daily plan combines eight content types in one file:

| Content type | What you'd want to do with it |
|--------------|-------------------------------|
| Decisions awaiting your judgment | Pick one option and record the choice |
| Priority tasks | Mark done; see your day's shape |
| Drafts ready to send | Copy / Edit / Open in Slack / Send |
| Briefing context (what happened) | Read once, then collapse |
| Meeting notes / standup highlights | Reference; rarely re-read |
| Sent message log | Audit trail |
| Sync state, repo status | Reference |
| Waiting-on items | Filter by owner; ping after N days |

If they all render as the same kind of HTML, the eye has to traverse the whole document to find what's actionable. Plans grow to 200–600 lines. The cost compounds.

The cockpit's design unit is **the atomic content type**: each section type gets a typed renderer, with affordances appropriate to what you'd do with it.

---

## What the cockpit shows

Region order is fixed:

1. **Glance bar** — date, day of week, status line, last-modified timestamp, filter chips, and counts (decisions / tasks / drafts / sent today).
2. **NEEDS YOU** — open decisions. Each card shows the question and options as buttons. Click an option and the cockpit writes a `**Decided:**` marker to the file.
3. **TODAY** — priority tasks. H3 buckets become collapsible groups; the first bucket is open by default. Each task is a checkbox. Clicking strikes through the task title and appends a `✅ DONE HH:MM TZ` marker.
4. **DRAFTS** — drafts ready to send. The action bar from the existing draft handling is reused verbatim (Copy / Edit / Open in Slack / Send-via-API).
5. **Lower-row collapsibles** — everything else (briefing / standup / waiting-on / sent log / PR queue / sync state). Each is a `<details>` element, default-collapsed. A "Full markdown" collapsible at the bottom always shows the unmodified markdown render as a fallback.

A `Focus` filter chip strips the page to NEEDS YOU + DRAFTS + first task bucket. An in-page find highlights matches across collapsed sections.

---

## How section detection works

The parser walks the markdown's H2 headings and matches their text (case-insensitive, substring) against a known vocabulary. The first match wins.

| H2 heading text contains... | Section kind |
|----------------------------|--------------|
| "Decisions needed" | `decisions` |
| "Priority Tasks" or "Tasks for" | `priority-tasks` |
| "Drafts" (with em-dash or hyphen) | `drafts` |
| "What happened" / "Big things" / "Things to know" / "Context" | `briefing` |
| "Standup" | `standup` |
| "Sent Messages" | `sent-messages` |
| "Waiting On" | `waiting` |
| "Open PR Queue" / "PR Queue" | `pr-queue` |
| "Sync state" | `sync-state` |
| anything else | `other` |

Sections of kind `other` render as plain markdown — nothing is hidden, just not specially typed. New section types you invent will fall through gracefully and still display.

### H3 buckets inside Priority Tasks

Tasks are grouped by H3 inside the `priority-tasks` H2. The cockpit doesn't require any specific H3 vocabulary — it preserves your H3s in document order and renders each as a collapsible bucket. The first bucket is expanded by default; the rest are collapsed with item counts.

If your H3 text matches a known phrase, the bucket gets a semantic tag (used only for muted styling on watch/stale buckets):

| H3 contains... | Semantic |
|---------------|----------|
| "not negotiable" / "high priority" / "critical" | `p0` |
| "should make it" / "medium priority" | `p1` |
| "can slip" / "lower priority" | `p2` |
| "watch" / "waiting" | `watch` |
| "stale" | `stale` |
| anything else | `other` (neutral color) |

Unknown H3s get neutral styling — they render the same as a known H3, just without the urgency tinting.

### Decisions

Inside a `decisions` H2, each H3 is a single decision. The parser looks for these patterns in the H3's body:

```markdown
**Option A:** Force-push origin/develop to trendhunter/develop.
**Option B:** Leave develop stale.
**Option C:** Investigate first.

Recommendation: **A** with --force-with-lease.
```

The cockpit renders the question (the H3 text), the option bodies, the recommendation, and a button per option. Clicking a button records the choice.

If the H3 already contains a `**Decided:** Option A — <date>` line, the cockpit shows it in decided state and disables the option buttons.

### Tasks

Inside any H3 under `priority-tasks`, the parser detects tasks as either:

- Numbered list items: `1. **Task title** — description`
- Checkbox-syntax items: `- [ ] Task title — description`

Already-done tasks are detected by any of:

- `~~strikethrough~~` markers around the title
- A leading `✅` emoji
- A leading `[x]` checkbox
- Leading `DONE` or `SENT` text in the first 60 chars

Already-done tasks render with strike-through and muted color but stay visible — the audit trail is the point.

---

## Write-back to the plan file

The cockpit writes back to your plan file via two compare-and-swap mutation types:

**Recording a decision** inserts a single line right after the H3 of the decision:

```
**Decided:** Option A — 2026-04-29 11:14 EDT
```

The original options stay in the file, so the audit trail shows the question, all considered options, and what was chosen.

**Marking a task done** rewrites the list-item line in place:

```
1. **Reply to @alex on the deploy plan** — quick, in #eng-team
```

becomes

```
1. ~~**Reply to @alex on the deploy plan**~~ ✅ **DONE 11:14 EDT** — quick, in #eng-team
```

Only the bold title is struck. The description stays readable so the line still tells you what was done. Unmark-done reverses this; it only undoes when the marker matches exactly the format the cockpit wrote, so manual edits to a task line aren't auto-reversible.

**Compare-and-swap discipline.** If the file changed since the cockpit page loaded (you edited the markdown in another editor, or another sync wrote to it), the server returns 409 with "reload and retry." The write is never partial — the cockpit uses a temp-file-plus-rename atomic write, the same pattern the v0.5 inline-draft-edit and v0.6 sent-marker writes already use.

---

## Formatting your plan for best results

The cockpit is tolerant of vocabulary variation, but a few conventions make it work best:

### Use H2 for section types

```markdown
## Decisions needed

## Priority Tasks

## Drafts — Ready to Send

## Waiting On Others

## Standup highlights

## Sent Messages

## Sync state
```

The parser matches on substring, so `## Decisions needed from Rajiv` works as well as `## Decisions Needed`. Pick whatever phrasing you like; just keep one section type per H2.

### Inside Priority Tasks, use H3 for buckets

```markdown
## Priority Tasks

### Do today — not negotiable

1. **Task one** — description
2. **Task two** — description

### Do today — should make it

3. **Task three** — description

### Stale targets

4. **Old commitment** — context
```

The cockpit picks up each H3 as a bucket; the first one is expanded by default. Bucket names like "High Priority" / "Medium Priority" / "Lower Priority" or "Immediate" / "This Week" also work — anything you put in an H3 becomes a bucket.

### Decisions live under H3s with options

```markdown
## Decisions needed

### 1. Force-push origin/develop to trendhunter/develop?

**Option A:** Force-push with --force-with-lease.
**Option B:** Leave it stale.
**Option C:** Investigate first.

Recommendation: **A** with --force-with-lease.
```

### Drafts use the existing `**Send to:**` convention

The cockpit reuses the existing draft detector unchanged. Format drafts with a `**Send to:**` paragraph and a fenced code block or blockquote for the body — see `docs/slack-integration.md` for the full convention.

### When in doubt, just write your plan

Anything the parser doesn't recognize falls through to plain markdown rendering inside an `<details>`-wrapped section. Nothing is hidden. The cockpit is opt-in via heuristic — if your plan looks "cockpit-shaped," you get the cockpit; if not, you get markdown rendering for any unrecognized parts and a "Full markdown" collapsible at the bottom always shows the original render.

---

## What the cockpit doesn't do

By design:

- **Mobile-optimized layout.** The cockpit collapses to single column at narrow widths but the design target is desktop. A mobile cockpit is a future phase.
- **Live auto-refresh on file change.** The glance bar shows "last updated HH:MM ago" so you can see the file age, but the page doesn't auto-refresh when the file changes. Manual reload is the current path.
- **Cross-day rollover.** "How many P0s have I been carrying for a week" is a clear future enhancement but not part of the cockpit today.
- **Search across plans.** The in-page find searches within the current plan only.
- **Calendar enrichment.** The `/plans` calendar list view is unchanged. Per-day counts on calendar cells are a future polish.

---

## Demo mode

Open the demo source's plans (e.g. `/plans/demo/<date>` after running `bun run demo`) to see the cockpit on bundled sample data. The demo is read-only — decisions and task checkboxes are disabled, drafts show but Edit and Send buttons are absent. This is the same demo-source discipline that v0.5 / v0.6 already enforce on the existing draft action bar.

---

## See also

- [`docs/slack-integration.md`](slack-integration.md) — draft action bar, mention pills, send-via-API
- [`docs/layouts.md`](layouts.md) — source schema and how `plans_dir` activates the daily-plans view
- [`docs/migration-v0.2.md`](migration-v0.2.md) — v0.1 → v0.2 config migration
