---
name: dep-audit
description: Audit dependency bumps (Dependabot/Renovate PRs, Helm chart bumps, lockfile updates) for breaking changes before merging. Use when asked to review version bumps in any ecosystem — npm, Go modules, Python, Helm charts, GitHub Actions. Args: optional branch/PR ref or list of bumps; defaults to bumps in the current diff.
---

Audit dependency version bumps for breaking changes and produce a risk matrix.

## Steps

1. **Enumerate bumps.** From args, the current branch diff, or open Dependabot PRs
   (`gh pr list --author 'app/dependabot'`). Record per bump: dependency,
   ecosystem (npm / go / python / helm / action), from → to, and whether it
   crosses a major.

2. **Research each bump.** Patch bumps of well-behaved deps get a changelog skim;
   majors and infrastructure charts get full treatment. If more than ~3 bumps need
   research, fan out one cheap-tier subagent per dependency, each returning only:
   breaking changes, migration steps, changed defaults. Sources: upstream
   CHANGELOG/release notes, upgrade guides, context7.

3. **Check against this repo's usage.** A breaking change matters only if the repo
   touches that surface — grep for usage of removed/renamed APIs, values keys, or
   CRD fields before flagging. Helm charts specifically: values schema changes,
   PVC/storage or StatefulSet changes (orphaning risk), CRD version bumps, changed
   replica/resource defaults, image/registry moves.

4. **Report a risk matrix.**
   `dependency | from → to | risk (low/med/high) | breaking changes that apply here | required actions`
   End with safe-to-merge, merge-with-actions, and blocker lists, stating which
   bumps were skimmed vs researched.
