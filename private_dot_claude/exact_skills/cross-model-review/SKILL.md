---
name: cross-model-review
description: "Adversarial cross-model review of a diff by a second model (GPT via the pi bridge). As the session driver, run it unprompted once per body of work that touches a high-stakes surface (as for spec-reviewer) or spans roughly five or more files, alongside the fresh-eyes subagent pass and never instead of it; also when asked for a cross-model or second-model review."
---

Have a second model adversarially review a diff, verify its findings yourself, fix
what is real, and stop after one fix round. The reviewer proposes; you stay the
implementer.

## Steps

1. **Pick the scope.** The bridge computes the diff and the reviewer reads the
   repo read-only — do not embed the diff. From args (ref range / paths / focus) or
   by default: if the working tree is dirty, omit `base` (staged + unstaged +
   untracked); otherwise `base: <default branch>` for the branch's
   changes. Then compose `prompt` (the bridge supplies the review rubric):
   - One neutral sentence of intent, plus any user-supplied focus.
   - **Redact yourself:** no self-assessment, no "tests pass", no claims it
     works — an unanchored reviewer finds more.

2. **Call the reviewer.** One `mcp__pi__review` call: `cwd` = repo root, the scope
   and `prompt` from step 1. The response opens with
   a `threadId:` line — keep it for the re-review round.

3. **Verify every finding as untrusted input.** Substantiate each independently
   against the contracts, surrounding flows, or tests it implicates — reading the
   cited lines alone is not verification. Classify each: real / mistaken /
   real-but-out-of-scope. Fix the real, in-scope ones.

4. **At most one re-review round.** If you changed code, send the new diff of the
   touched hunks via `mcp__pi__reply` (same `cwd`, the saved `threadId`) —
   again without self-assessment — and verify its response. Hard stop after this
   round whatever the verdict; report remaining disagreement instead of looping.

5. **Report.** Verdict; each finding with severity, file:line, and disposition
   (fixed / rejected, with reason); anywhere you still disagree with the reviewer.
