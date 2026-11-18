---
name: ship-check
description: "Use only on explicit invocation or an explicit user request for ship-check: one pre-ship review of the branch, or the scope given, against a fixed ship bar, plus approved fixes; not automatic implementation completion, generic review or routine verification. Args: optional base ref (default main), a narrower scope, or one lens."
---

Review the scope once and say whether it can ship. The bar is fixed: a finding
blocks only when the changed code behaves wrongly, risks security or data
loss, or breaks a contract. Everything else is reported as optional and never
holds the verdict. Once no blocker remains the scope ships; do not reopen the
review to look for more.

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
duplicates; drop taste, wording and anything not tied to a changed line.

**Report.** Blockers first, then optional findings, each as `severity | lens |
file:line | issue | proposed fix`, then a one-line verdict: ship, or the
blockers that stop it. With nothing to fix, or on a review-only request, stop
here. Otherwise, in plan mode, submit the proposed fixes through the plan
approval flow without waiting to be asked.

**Fix.** Only the findings I select, each inside its defect. Re-review the
fixes alone, once. A fix the re-review still blocks comes back to me with the
evidence; anything else it turns up is optional. End with the verdict.
