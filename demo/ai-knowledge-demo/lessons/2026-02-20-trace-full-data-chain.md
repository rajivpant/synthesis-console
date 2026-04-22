# Lesson: Trace the Full Data Chain

**Date:** 2026-02-20
**Project:** api-v3-migration
**Category:** debugging, verification

---

## Context

During the API migration, a field appeared correct in unit tests but produced wrong values in production. The test mocked the intermediate transformation, hiding a type coercion bug.

## The Insight

When verifying correctness, trace data from origin to destination through every transformation step. Mocked intermediaries hide real behavior.

## The Rule

Before declaring a data pipeline correct, follow one real record from source to sink. No mocks, no shortcuts.
