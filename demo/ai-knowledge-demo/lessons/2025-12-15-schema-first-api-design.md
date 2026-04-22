# Lesson: Schema-First API Design

**Date:** 2025-12-15
**Project:** api-v3-migration
**Category:** architecture, API design

---

## Context

Early API endpoints were built code-first: write the handler, then document the interface. This led to inconsistent response shapes and undocumented edge cases.

## The Insight

Define the schema before writing the implementation. The schema is a contract. Code generation from the schema ensures the implementation matches the contract exactly.

## The Rule

For any API with more than one consumer, start with the schema. Generate types, validators, and documentation from it. The schema is the source of truth, not the code.
