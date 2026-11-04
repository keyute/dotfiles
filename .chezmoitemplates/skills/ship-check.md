---
name: ship-check
description: "Use only on explicit invocation or an explicit user request for ship-check: full-branch pre-ship review and approved fixes, not automatic implementation completion, generic review or routine verification. Args: optional base ref (default main) or one lens."
---

Review the full branch initially; delegate reading/finding to pinned workers and
keep adjudication and synthesis in the driver. Preserve snapshot-scoped finding
IDs and dispositions throughout the authorized iteration.

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
   `diff-reviewer` correctness pass (`infra-reviewer` for manifests); do not review
   it inline.

3. **Find — fan out to pinned reviewers only.** Dispatch in parallel, only to named
   pinned reviewer agents — an unpinned or built-in worker lacks the role's tool
   scope, pinned effort and return format:
   - one `diff-reviewer` correctness pass per group (`infra-reviewer` for
     Kubernetes/Helm/ArgoCD manifests);
   - one `diff-reviewer` simplify pass on any nontrivial diff — quality coverage is
     this skill's job, not a separate command's;
   - one `diff-reviewer` test-coverage pass only where behavior changed or regression
     risk is real.
   Give each worker the exact base…worktree scope, its file group, and its lens; take
   findings back in the shared reviewer format.

4. **Dedup and verify by group.** Assign snapshot-scoped IDs to input findings.
   Batch fact/churn verification by semantic group, not two agents per finding.
   Confirm changed-line evidence from code, tests or contracts; retain only wrong
   behavior or concrete structural cost whose fix repays its churn. Reject taste,
   wording/wrapping and line-count trims. Before synthesis, whether using workflow
   scripts or direct reviewer dispatch, mechanically assert that every input ID has exactly one disposition:
   kept, merged-to ID, refuted with evidence, or deferred with reason; validate
   merge targets. Use existing workflow maps/arrays or a bounded scratch check for
   direct reviewer dispatch, not a new persistent tool. Reuse completed maps for a new
   output format instead of rerunning investigation.

5. **Present for approval.** Rank verified survivors by severity in a checklist
   artifact — `severity | lens | file:line | issue | proposed fix` — with stable
   finding IDs and a one-line ship/no-ship gate blocking only on what makes the
   branch unshippable now. If there are no survivors, give the clean ship verdict
   and stop without a plan. Respect an explicit review-only request: return the
   checklist and verdict without seeking execution approval. Otherwise, in plan
   mode, proactively submit the nonempty checklist of proposed fixes through the
   harness's native plan approval flow; do not wait for a separate “fix them”
   prompt. Let the user select findings by ID and revise the same artifact for
   approval of that selection, rather than treating feedback as blanket approval.

6. **Fix on approval, then call it.** Apply only the selected findings in the
   approved revision, after native approval enables execution where required.
   Keep each fix inside its defect: no adjacent cleanup or new capability.
   Adjudicate command/result evidence with snapshot and environment boundaries;
   rerun only for changed relevant inputs, missing evidence or concrete doubt.
   Subsequent review covers fixes and affected dependencies, retaining IDs and
   dispositions; restart full review only for new evidence, cross-scope changes or
   an explicit fresh-review request. End with the ship verdict.
