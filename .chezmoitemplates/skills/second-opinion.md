---
name: second-opinion
description: Get an independent second opinion from Codex (GPT) on an architecture decision, approach trade-off, stuck bug, or judgment call. Use when asked for a second opinion, an outside take, or what Codex/GPT thinks. Args: optional question; defaults to the open question in the conversation.
---

Consult Codex as an independent advisor and return a synthesis, not a verdict. The
value is a decorrelated perspective — protect it from anchoring.

## Steps

1. **Load the tools.** If `mcp__codex__codex` / `mcp__codex__codex-reply` are not
   loaded, fetch them via ToolSearch (`select:mcp__codex__codex,mcp__codex__codex-reply`).
   If the server is missing, stop and say so (codex not installed, or `~/.claude.json`
   not yet re-applied via chezmoi).

2. **Form your own position first — silently.** You need it for the comparison; it
   must not leak into the prompt.

3. **Compose a neutral, self-contained brief.** Question = args, else the open
   question in the conversation. Include:
   - the question without tilt — no "we're leaning towards X", no
     preference-ordered options, no preselling adjectives
   - hard constraints and context (scale, team, existing stack, deadlines)
   - relevant file paths — Codex reads them read-only from the repo root
   - for a stuck bug: symptoms, what was ruled out and how, exact errors
   - an explicit ask: recommendation with reasoning plus the strongest argument
     against it

4. **Call Codex.** One `mcp__codex__codex` call with the brief: sandbox read-only,
   approval policy never, cwd = repo root, config override
   `{"model_reasoning_effort": "high"}`. Probe weak points or follow up with
   `mcp__codex__codex-reply` on the same thread — challenge reasoning that
   conflicts with yours rather than accepting or dismissing it.

5. **Synthesize and report.** Codex's position and reasoning, briefly; where it
   agrees and disagrees with yours, and why; your final recommendation, owning the
   decision — if you reject its advice say what it missed, if you adopt it say
   what you had missed. Verify any factual claims Codex made about the code before
   repeating them.
