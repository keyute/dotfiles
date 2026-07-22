---
name: align-sibling
description: Align this repo with recent changes made in a sibling repo (e.g. backend → dashboard, API → client). Use when asked to review changes in another repo and reflect, surface, or align them here. Args: sibling repo path; optional ref range (e.g. main@{1.week.ago}..main) or feature description.
---

Align the current repo with contract changes made in a sibling repo.

## Steps

1. **Resolve scope.** Sibling repo path from args; ask if missing. Change range:
   explicit ref range from args, else infer it from recent `git log` topics on
   both sides since the last alignment, and confirm the inferred range with the
   user before deep review.

2. **Extract contract changes.** Review the sibling diff for anything a consumer
   can observe — delegate to a subagent if large, keeping only the summary:
   - endpoints/routes added, removed, or re-shaped (paths, methods, status codes)
   - request/response types, fields, enums, validation rules
   - roles, permissions, scopes
   - schemas, migrations, events, webhooks
   - config/env vars, ports, feature flags
   Ignore sibling-internal refactors with no observable contract change.

3. **Map to this repo.** For each change, search for consumers (clients, types,
   forms, guards, config). Build a gap table:
   `sibling change → affected files here → action (add/update/remove/none)`.

4. **Report, then implement.** Show the gap table first. Follow the applicable
   project instruction files (`AGENTS.md`/`CLAUDE.md`), implement each gap with
   this repo's existing patterns — invent none. Remove consumers of contracts
   that no longer exist.

5. **Verify.** Run this repo's typecheck/tests/lint. List anything not
   mechanically verifiable (e.g. runtime behavior against the sibling) as untested.
