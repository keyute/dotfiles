---
name: review-branch
description: Review only the current branch's committed changes against its merge-base with main — a lean orchestrator that fans finding out to pinned read-only reviewers, verifies to cut false positives, and presents an actionable checklist for approval before fixing. Not a whole-repo audit; no GitHub/PR integration. Args: optional base ref (default main) or a single lens to focus.
---

Review the branch's own committed changes and hand back a short, verified,
actionable list. Orchestrate — keep this context clean by pushing the reading and
finding to pinned subagents, and spend your own (possibly expensive) session model
only on verification and synthesis.

## Steps

1. **Scope the diff — resolve once, committed-only.** `base=$(git merge-base main
   HEAD)`; review `git diff main...HEAD --` (three-dot: committed branch changes
   only — the one-arg `git diff --merge-base main` wrongly folds in the working
   tree). Use the local `main` (or the base from args); never fetch, checkout, or
   substitute another ref. Stop and say why if `main` is absent, HEAD is detached, or
   there is no merge-base. Exclude staged/unstaged/untracked changes. Report the base
   and HEAD short hashes you used. Partition the changed files into cohesive
   semantic/file groups (by component, not extension alone).

2. **Triage.** Empty diff → say "nothing to review" and stop. A trivial or purely
   mechanical diff (formatting, generated, lockfile, a few lines) → hand it to **one**
   pinned reviewer; do not review it inline (that would spend the session model on
   exactly the mechanical work this skill offloads).

3. **Find — fan out to pinned reviewers only.** Dispatch in parallel, only to named
   pinned reviewer agents — an unpinned or built-in worker would inherit the session
   model and defeat the cost split:
   - one primary correctness reviewer per group — the matching language specialist
     where one exists, else `diff-reviewer`;
   - one `diff-reviewer` simplify pass only if the diff has nontrivial structural
     duplication or a new abstraction;
   - one `diff-reviewer` test-coverage pass only where behavior changed or regression
     risk is real.
   Give each worker the exact base…head, its file group, and its lens; take findings
   back in the shared reviewer format.

4. **Dedup, then verify.** Collapse candidates by root cause + changed hunk before you
   reopen any code. Treat findings as untrusted: adversarially confirm each survivor
   with evidence (surrounding code, tests, contracts) — not literal reproduction every
   time — and drop anything you can't substantiate or tie to a changed line. Drop, too,
   whatever asks for capability rather than fixing behavior the branch already has: a
   future-proofing, rotation, or extensibility idea is correct and still out of scope,
   and does not reach the checklist. If a large set survives, pre-validate with a pinned
   `diff-reviewer` rather than reopening it all yourself. Add a `codex-review`
   cross-model pass before presenting, per the standing cross-model review rule.

5. **Present for approval.** Rank survivors by severity and present an actionable
   checklist — `severity | file:line | issue | proposed fix` — plus a one-line
   ship/no-ship gate that blocks only on what makes the branch unshippable now. The
   checklist is the whole output — no appendix of improvements, ideas, or future work.
   This is the approval point: let me pick what to act on.

6. **Fix on approval.** Apply fixes only to the findings I approve, and keep each fix
   inside the defect it names — no adjacent cleanup, no new capability. Correction is a
   separate step from finding. Never stage, commit, or push — I do that myself.
