# Lesson: Set a Dependency Budget

**Date:** 2025-11-20
**Project:** synthesis-console
**Category:** architecture, dependencies

---

## Context

A previous project accumulated 47 direct dependencies over 18 months. Security audits became a recurring tax. Two dependencies were abandoned by maintainers, requiring emergency replacements.

## The Insight

Set an explicit dependency budget before starting a project. Every dependency is an attack surface, a maintenance burden, and a compatibility risk. When the cost of building a feature yourself is low, the dependency is not worth the ongoing tax.

## The Rule

Before adding a dependency, ask: does this save more engineering time over the project's life than the maintenance cost it introduces? If the answer is ambiguous, build it yourself.
