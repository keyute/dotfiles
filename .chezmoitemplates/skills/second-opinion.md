---
name: second-opinion
description: Get an independent second opinion from Codex (GPT) on an architecture decision, approach trade-off, stuck bug, or judgment call, then compare positions and synthesize. Use when asked for a second opinion, an outside take, or what Codex/GPT thinks. Args: optional question; defaults to the open question in the conversation.
---

Consult Codex as an independent advisor and come back with a synthesis, not a
verdict. The value is a decorrelated perspective — protect it from anchoring.

## Steps

1. **Load the tools.** If `mcp__codex__codex` / `mcp__codex__codex-reply` are not
   loaded, fetch them with ToolSearch (`select:mcp__codex__codex,mcp__codex__codex-reply`).
   If the server is missing, stop and say so (codex not installed, or `~/.claude.json`
   not yet re-applied via chezmoi).

2. **Form your own position first — silently.** Decide what you would recommend and
   why. You will need it for the comparison, but it must not leak into the prompt.

3. **Compose a neutral, self-contained brief.** The question is the args or, if
   absent, the open question in the conversation. Include:
   - the question, stated without tilt — no "we're leaning towards X", no options
     ordered by preference, no adjectives that presell an answer
   - hard constraints and context (scale, team, existing stack, deadlines)
   - relevant file paths — Codex runs read-only in the repo root and can read them
   - for a stuck bug: symptoms, what has been ruled out and how, exact errors
   - explicitly ask for a recommendation with reasoning and the strongest argument
     against it

4. **Call Codex.** One `mcp__codex__codex` call with the brief, the sandbox set to
   read-only, the approval policy set to never, cwd set to the repo root, and the
   config override `{"model_reasoning_effort": "high"}` (judgment-quality work
   scales with effort; matches this setup's plan-mode effort). Use
   `mcp__codex__codex-reply` on the same thread to probe weak points or ask
   follow-ups — challenge its reasoning where it conflicts with yours instead of
   accepting or dismissing it.

5. **Synthesize and report.**
   - Codex's position and its reasoning, briefly
   - where it agrees with your own view, and where it disagrees and why
   - your final recommendation, owning the decision — if you reject Codex's advice,
     say what it missed; if you adopt it, say what you had missed
   - verify any factual claims Codex made about the code before repeating them
