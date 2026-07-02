---
name: align-sibling
description: Align this repo with recent changes made in a sibling repo (e.g. backend → dashboard, API → client). Use when asked to review changes in another repo and reflect, surface, or align them here. Args: path to the sibling repo, optionally a ref range (e.g. main@{1.week.ago}..main) or a description of the feature to align on.
---

Align the current repo with contract changes made in a sibling repo.

## Steps

1. **Resolve scope.** Get the sibling repo path from args; if missing, ask. Determine
   the change range: an explicit ref range from args, otherwise infer it — find the
   sibling commits since this repo last aligned (compare recent `git log` topics on
   both sides) and confirm the inferred range with the user before deep review.

2. **Extract contract changes.** Review the sibling diff for anything a consumer can
   observe — delegate to a subagent if the diff is large, keeping only the contract
   summary:
   - endpoints/routes added, removed, or re-shaped (paths, methods, status codes)
   - request/response types, fields, enums, validation rules
   - roles, permissions, scopes
   - schemas, migrations, events, webhooks
   - config/env vars, ports, feature flags
   Ignore sibling-internal refactors that change no observable contract.

3. **Map to this repo.** For each contract change, search this repo for consumers
   (clients, types, forms, guards, config). Build a gap table:
   `sibling change → affected files here → action (add/update/remove/none)`.

4. **Report, then implement.** Show the gap table first. Implement each gap following
   this repo's existing patterns (check CLAUDE.md and surrounding code); do not invent
   new patterns during alignment. Remove consumers of contracts that no longer exist.

5. **Verify.** Run this repo's typecheck/tests/lint. Anything that cannot be verified
   mechanically (e.g. runtime behavior against the sibling), list explicitly as
   untested.
