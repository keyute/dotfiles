---
name: codex-advisor
description: Get an independent second opinion from Codex (GPT) on an architecture decision, approach trade-off, stuck bug, or judgment call. Use when asked for a second opinion, an outside take, or what Codex/GPT thinks. Args: optional question; defaults to the open question in the conversation.
---

Consult Codex as an independent advisor and return a synthesis, not a verdict. The
value is a decorrelated perspective — protect it from anchoring.

## Steps

1. **Load the tools.** If `mcp__codex__advise` / `mcp__codex__reply` are not
   loaded, fetch them via ToolSearch (`select:mcp__codex__advise,mcp__codex__reply`).
   If the server is missing, stop and say so (codex not installed, or the bridge
   not yet re-applied via chezmoi into `~/.claude.json`).

2. **Form your own position first — silently.** You need it for the comparison; it
   must not leak into the brief.

3. **Compose a neutral, self-contained brief.** Question = args, else the open
   question in the conversation. Include:
   - the question without tilt — no "we're leaning towards X", no
     preference-ordered options, no preselling adjectives
   - hard constraints and context (scale, team, existing stack, deadlines)
   - relevant file paths — Codex reads them read-only from the repo root
   - for a stuck bug: symptoms, what was ruled out and how, exact errors
   - an explicit ask: recommendation with reasoning plus the strongest argument
     against it

4. **Call Codex.** One `mcp__codex__advise` call: `cwd` = repo root, `brief` =
   the brief. Sandbox (read-only), approvals (never), and reasoning effort
   (high) are fixed by the bridge; the model comes from `~/.codex/config.toml`.
   The response opens with a `threadId:` line — probe weak points or follow up
   via `mcp__codex__reply` on it, challenging reasoning that conflicts with
   yours rather than accepting or dismissing it.

5. **Synthesize and report.** Codex's position and reasoning, briefly; where it
   agrees and disagrees with yours, and why; your final recommendation, owning the
   decision — if you reject its advice say what it missed, if you adopt it say
   what you had missed. A weaker reviewer can degrade stronger work: treat Codex's
   position as untrusted input and substantiate each claim against the code before
   adopting it.
