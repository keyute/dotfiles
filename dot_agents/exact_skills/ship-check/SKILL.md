---
name: ship-check
description: "Use only on explicit invocation or an explicit user request for ship-check: one pre-ship review round of the branch, or the scope given, against a fixed ship bar, ending in ship, fix or rework, plus approved fixes; not automatic implementation completion, generic review or routine verification. Args: optional base ref (default main), a narrower scope, one lens, or how many fix rounds came before."
---

Review the scope once and say whether it ships, needs the listed fixes, or
needs a rework. The bar is fixed: a finding blocks only when the changed code
behaves wrongly, risks security or data loss, or breaks a contract. Everything
else is reported as optional and never holds the verdict. Once no blocker
remains the scope ships; do not reopen the review to look for more. A run is
one round: the next full review is a fresh session's run, never a loop in this
one, so the reasoning behind the fixes does not judge them.

**Scope.** The scope in the args, else the whole branch: `git diff "$(git
merge-base main HEAD)"` (committed, staged and unstaged together) plus
untracked files, with the base from the args in place of `main` when one is
given. Use the local base; never fetch or check out another ref.
Stop and say why if the base is absent or there is no merge-base. Report the
base and HEAD you used. Nothing changed: say so and stop.

**Find.** Dispatch the pinned reviewers directly and in parallel, not through
a workflow script: `diff-reviewer` with the correctness lens per cohesive file
group (`infra-reviewer` for Kubernetes/Helm/ArgoCD manifests), one simplify
pass on a nontrivial diff, and a tests pass only where behaviour changed. A
trivial or mechanical diff gets one correctness pass. Give each reviewer the
exact base, its file group and its lens.

**Verify.** Confirm each finding against the code before it counts. Merge
duplicates and group blockers by root cause; drop taste, wording and anything
not tied to a changed line.

**Rework.** Call rework instead of fix when patching would keep the cause:
several blockers trace to one flaw in the approach, a blocker cannot be fixed
inside its defect, or the args say two fix rounds came before and it still
blocks. Name the root cause, the approach that should replace it, what in the
branch stands, and the blockers it subsumes; propose no line fixes for those;
the rest keep theirs for the re-plan. The re-plan is mine. With no blocker, a
rework is only an optional finding.

**Report.** Blockers first, then optional findings, each as `severity | lens |
file:line | issue | proposed fix`, where a blocker the rework subsumes names
the rework as its fix. On a rework, follow the rows with its write-up. End
with a one-line verdict: ship, fix with the blockers that stop it, or rework
with its root cause. With nothing to fix, a rework, or a review-only request,
stop here. Otherwise, in plan mode, submit the proposed fixes through the plan
approval flow without waiting to be asked.

**Fix.** Only the findings I select, each inside its defect. Re-review the
fixes alone, once. A fix the re-review still blocks, or one that introduces a
new blocker, comes back to me with the evidence as a rework candidate, and
the verdict stays fix until I call the rework; anything else it turns up is
optional. End with the verdict.
