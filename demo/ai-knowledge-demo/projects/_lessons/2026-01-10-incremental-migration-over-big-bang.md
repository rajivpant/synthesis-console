# Lesson: Incremental Migration Over Big-Bang Rewrites

**Date:** 2026-01-10
**Project:** api-v3-migration
**Category:** architecture, migration

---

## Context

Faced a choice between migrating all 23 API endpoints at once or converting them one at a time with a compatibility layer.

## The Insight

Incremental migration with a compatibility layer is slower but dramatically safer. Each endpoint can be validated independently. Rollback scope is a single endpoint, not the entire API.

## The Rule

When migrating systems, build a compatibility layer and convert incrementally. The overhead of maintaining two paths temporarily is far less than the risk of a failed big-bang cutover.
