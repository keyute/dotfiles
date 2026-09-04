---
name: ship-check
description: One converging pre-ship review of the branch's full state — committed and uncommitted — against its merge-base with main: correctness and quality (reuse, simplification, efficiency, altitude) in a single verified pass, holding a churn bar so a clean branch gets "ship it" rather than one more thing. Not a whole-repo audit; no GitHub/PR integration. Args: optional base ref (default main) or a single lens to focus.
---

Review everything this branch would ship — committed and uncommitted alike — and
hand back a short, verified, actionable list, then a ship verdict. Orchestrate —
keep this context clean by pushing the reading and finding to pinned subagents,
and spend your own (possibly expensive) session model only on verification and
synthesis.

## Steps

1. **Scope the diff — resolve once, the full branch state.** `base=$(git
   merge-base main HEAD)`; review `git diff "$base"` (one-arg: merge-base to
   working tree — committed, staged, and unstaged together) plus untracked files
   from `git ls-files --others --exclude-standard`. Use the local `main` (or the
   base from args); never fetch, checkout, or substitute another ref. Stop and
   say why if `main` is absent, HEAD is detached, or there is no merge-base.
   Report the base and HEAD short hashes you used and whether the tree is dirty.
   Partition the changed files into cohesive semantic/file groups (by component,
   not extension alone).

2. **Triage.** Empty diff → say "nothing to review" and stop. A trivial or purely
   mechanical diff (formatting, generated, lockfile, a few lines) → hand it to **one**
   pinned reviewer; do not review it inline (that would spend the session model on
   exactly the mechanical work this skill offloads).

3. **Find — fan out to pinned reviewers only.** Dispatch in parallel, only to named
   pinned reviewer agents — an unpinned or built-in worker would inherit the session
   model and defeat the cost split:
   - one primary correctness reviewer per group — the matching language specialist
     where one exists, else `diff-reviewer`;
   - one `diff-reviewer` simplify pass on any nontrivial diff — quality coverage is
     this skill's job, not a separate command's;
   - one `diff-reviewer` test-coverage pass only where behavior changed or regression
     risk is real.
   Give each worker the exact base…worktree scope, its file group, and its lens; take
   findings back in the shared reviewer format.

4. **Dedup, then verify against the churn bar.** Collapse candidates by root cause +
   changed hunk before you reopen any code. Treat findings as untrusted: adversarially
   confirm each survivor with evidence (surrounding code, tests, contracts) — not
   literal reproduction every time — and drop anything you can't substantiate or tie
   to a changed line. Drop, too, whatever asks for capability rather than fixing
   behavior the branch already has: a future-proofing, rotation, or extensibility idea
   is correct and still out of scope. A surviving finding must name either behavior
   that is wrong now, or a concrete structural cost — a duplicated helper, wasted
   work, the wrong altitude — whose fix pays for itself the next time the code is
   read or changed. Never wording, wrapping, comment or doc phrasing, line-count
   trims, or a matter-of-taste alternative to a choice the diff already made: the
   bar is what lets a pass over already-reviewed code come back empty and say "ship"
   instead of restarting the churn. If a large set survives, pre-validate with a
   pinned `diff-reviewer` rather than reopening it all yourself. Add a cross-model
   review pass before presenting, per your standing cross-model review rule; skip it
   if no decorrelated model is available.

5. **Present for approval.** Rank survivors by severity and present an actionable
   checklist — `severity | lens | file:line | issue | proposed fix` — plus a one-line
   ship/no-ship gate that blocks only on what makes the branch unshippable now. The
   checklist is the whole output — no appendix of improvements, ideas, or future work.
   This is the approval point: let me pick what to act on.

6. **Fix on approval, then call it.** Apply fixes only to the findings I approve, and
   keep each fix inside the defect it names — no adjacent cleanup, no new capability.
   Correction is a separate step from finding. Never stage, commit, or push — I do
   that myself. End with the ship verdict.
