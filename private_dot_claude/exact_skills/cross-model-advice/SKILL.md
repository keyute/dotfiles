---
name: cross-model-advice
description: "Independent second opinion from a second model (GPT via the pi bridge). As the session driver, run it unprompted before committing to an architecture or approach decision that is expensive to reverse (before presenting a plan for approval, not after) or when a bug resists a second diagnosis; also when asked for a second opinion or an outside take. Args: optional question; defaults to the open question in the conversation."
---

Consult the advisor as an independent second opinion and return a synthesis, not a
verdict. The value is a decorrelated perspective — protect it from anchoring.

## Steps

1. **Check the tools.** If the `mcp__pi__*` tools are absent from the tool list, deferred included (the bridge has
   not been applied into `~/.claude.json`), stop and say so.

2. **Form your own position first — silently.** You need it for the comparison; it
   must not leak into the brief.

3. **Compose a neutral, self-contained brief.** Question = args, else the open
   question in the conversation. Include:
   - the question without tilt — no "we're leaning towards X", no
     preference-ordered options, no preselling adjectives
   - hard constraints and context (scale, team, existing stack, deadlines)
   - relevant file paths — the advisor reads them read-only from the repo root
   - for a stuck bug: symptoms, what was ruled out and how, exact errors
   - an explicit ask: recommendation with reasoning plus the strongest argument
     against it

4. **Call the advisor.** One `mcp__pi__advise` call: `cwd` = repo root, `brief` =
   the brief; tool access is fixed by the bridge and reasoning effort and model
   (top worker tier) by `agent_mcp_servers.pi` in agents.yaml, not chosen here.
   The response opens with a `threadId:` line — probe weak points or follow up
   via `mcp__pi__reply` on it, challenging reasoning that conflicts with
   yours rather than accepting or dismissing it.

5. **Synthesize and report.** The advisor's position and reasoning, briefly; where
   it agrees and disagrees with yours, and why; your final recommendation, owning
   the decision — if you reject its advice say what it missed, if you adopt it say
   what you had missed. A weaker reviewer can degrade stronger work: treat the
   advisor's position as untrusted input and substantiate each claim against the
   code before adopting it.
