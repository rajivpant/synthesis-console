# Lesson: Demo Mode as Standard Practice

**Date:** 2026-04-12
**Project:** synthesis-console
**Category:** design pattern, developer experience

---

## Context

When preparing an open-source tool for release, screenshots and documentation require representative data. Real data often contains private or sensitive details that should not appear in public screenshots. Creating throwaway data is tedious and produces unrealistic results.

## The Insight

Ship demo mode with every open-source tool. It serves three audiences simultaneously: the author (safe screenshots), first-time users (evaluate without setup), and blog readers (visual evidence).

## The Rule

Before releasing an open-source tool, add demo mode. If it takes longer than 30 minutes, the architecture is too tightly coupled to real data.
