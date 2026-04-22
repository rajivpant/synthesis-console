# Lesson: Convention Over Configuration

**Date:** 2026-03-15
**Project:** workspace-orchestration
**Category:** architecture, design principle

---

## Context

As the number of workspaces and repos grew, maintaining explicit configuration for each became a burden. Every new repo required updating multiple config files.

## The Insight

When you adopt strong naming conventions (ai-knowledge-{name}, CONTEXT.md, REFERENCE.md, index.yaml), tools can auto-discover content without configuration. The filesystem becomes the configuration.

## The Rule

Design tools that discover content by convention first. Only require explicit configuration for overrides.
