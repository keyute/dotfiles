---
name: codex-review
description: Adversarial cross-model review of a diff by Codex (GPT) via the codex MCP server. Use when asked to have Codex review changes, get a cross-model review, or pressure-test a diff before committing. Args: optional ref range, paths, or focus area; defaults to the working-tree diff.
---

Have Codex adversarially review a diff, verify its findings yourself, fix what is
real, and stop after one fix round. Codex reviews; you stay the implementer.

## Steps

1. **Load the tools.** If `mcp__codex__codex` / `mcp__codex__codex-reply` are not
   loaded, fetch them via ToolSearch (`select:mcp__codex__codex,mcp__codex__codex-reply`).
   If the server is missing, stop and say so (codex not installed, or `~/.claude.json`
   not yet re-applied via chezmoi).

2. **Build the handoff.** Scope = args (ref range / paths / focus) or, by default,
   the working-tree diff against the merge-base with the default branch, staged +
   unstaged, plus untracked files belonging to the change.
   - One neutral sentence of intent.
   - The diff inline; for large diffs send the changed-file list instead — Codex
     reads the repo itself (read-only, repo root).
   - **Redact yourself:** no self-assessment, no "tests pass", no claims it works —
     an unanchored reviewer finds more.

3. **Call Codex.** One `mcp__codex__codex` call with the prompt below: sandbox
   read-only, approval policy never, cwd = repo root, config override
   `{"model_reasoning_effort": "high"}` (quality ~doubles over medium at ~1.4x
   cost; not xhigh — limit burn, nitpick noise). Model comes from `~/.codex/config.toml`.

4. **Verify every finding as untrusted input.** Read the cited code; classify each:
   real / mistaken / real-but-out-of-scope. Fix the real, in-scope ones.

5. **At most one re-review round.** If you changed code, send the new diff of the
   touched hunks via `mcp__codex__codex-reply` on the same thread — again without
   self-assessment — and verify its response. Hard stop after this round whatever
   the verdict; report remaining disagreement instead of looping.

6. **Report.** Verdict; each finding with severity, file:line, and disposition
   (fixed / rejected, with reason); anywhere you still disagree with Codex.

## Review prompt

```
You are performing an adversarial software review. Your job is to break confidence
in the change, not to validate it.

Intent of the change: <one neutral sentence>
Focus (optional): <user-supplied focus>

<diff or changed-file list>

Default to skepticism: assume the change can fail in subtle, high-cost, or
user-visible ways until the evidence says otherwise. No credit for good intent,
partial fixes, or likely follow-up work; happy-path-only behavior is a real
weakness. You have read-only access to the repository — read any file you need.

Prioritize failures that are expensive, dangerous, or hard to detect: auth and
trust boundaries; data loss, corruption, or irreversible state; rollback, retry,
partial-failure, and idempotency gaps; races, ordering assumptions, re-entrancy;
empty/null/timeout and degraded-dependency behavior; version skew, schema drift,
migration hazards; observability gaps that would hide failure.

Report only material findings — no style, naming, or speculative concerns without
evidence. Every finding must be defensible from repository context: do not invent
files, lines, or runtime behavior; mark inferences as such and keep confidence
honest. Prefer one strong finding over several weak ones; if the change looks
safe, say so and return no findings.

End with exactly this JSON structure in a fenced block:
{
  "verdict": "approve" | "needs-attention",
  "summary": "<terse ship/no-ship assessment>",
  "findings": [
    {
      "severity": "critical" | "high" | "medium" | "low",
      "title": "...",
      "body": "what can go wrong, why this path is vulnerable, likely impact",
      "file": "path",
      "line_start": N,
      "line_end": N,
      "confidence": 0.0-1.0,
      "recommendation": "concrete change that reduces the risk"
    }
  ]
}
Use "needs-attention" if any material risk is worth blocking on; "approve" only if
you cannot support any substantive adversarial finding.
```
