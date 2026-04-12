# Workspace Orchestration — Reference

## Workspace Model

| Workspace | Type | Purpose |
|-----------|------|---------|
| personal | Person | Individual projects, knowledge base |
| team-alpha | Org | Team-specific repos and workflows |
| consulting | Org | Client engagement repos |

## Design Principles

1. Convention over configuration — same structure everywhere
2. Single source of truth — index.yaml is authoritative for project state
3. Self-describing files — front matter, date prefixes, naming conventions
4. Agents do the work — no templates; examine existing examples and adapt
