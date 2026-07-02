---
name: dep-audit
description: Audit dependency bumps (Dependabot/Renovate PRs, Helm chart bumps, lockfile updates) for breaking changes before merging. Use when asked to review version bumps in any ecosystem — npm, Go modules, Python, Helm charts, GitHub Actions. Args: optionally a branch/PR ref or a list of bumps; defaults to bumps in the current diff.
---

Audit dependency version bumps for breaking changes and produce a risk matrix.

## Steps

1. **Enumerate bumps.** From args, the current branch diff, or open Dependabot PRs
   (`gh pr list --author 'app/dependabot'`). For each bump record: dependency,
   ecosystem (npm / go / python / helm / action), from → to version, and whether it
   crosses a major version.

2. **Research each bump.** Patch-level bumps of well-behaved deps need only a changelog
   skim; majors and infrastructure charts get full treatment. When more than ~3 bumps
   need research, fan out one cheap-tier subagent per dependency, each returning only:
   breaking changes, migration steps, changed defaults. Sources: upstream
   CHANGELOG/release notes (GitHub releases), upgrade guides, context7 for library docs.

3. **Check against this repo's usage.** A breaking change only matters if the repo
   touches that surface — grep for actual usage of removed/renamed APIs, values keys,
   or CRD fields before flagging. For Helm charts specifically check: values schema
   changes, PVC/storage or StatefulSet changes (orphaning risk), CRD version bumps,
   changed replica/resource defaults, image/registry moves.

4. **Report a risk matrix.**
   `dependency | from → to | risk (low/med/high) | breaking changes that apply here | required actions`
   End with: safe-to-merge list, merge-with-actions list, and blockers. State which
   bumps were skimmed vs researched so nothing reads as covered when it wasn't.
