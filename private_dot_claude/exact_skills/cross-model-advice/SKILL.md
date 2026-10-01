---
name: cross-model-advice
description: "Independent flaw-finding pass on a candidate approach by a second model (GPT via the pi bridge). As the session driver, run it unprompted before committing to an architecture or approach decision that is expensive to reverse (before presenting a plan for approval, not after) or when a bug resists a second diagnosis; also when asked for a second opinion or an outside take."
---

Consult the advisor for flaws you can check, not for a verdict, and return a
synthesis. The value is decorrelated error-finding — protect it from anchoring, and
never count the advisor's agreement or concession as evidence.

## Steps

1. **Form your own position first — silently.** You need it for the comparison; it
   must not leak into the brief.

2. **Compose a neutral, self-contained brief.** Question = args, else the open
   question in the conversation. Include:
   - the question without tilt — no "we're leaning towards X", no
     preference-ordered options, no preselling adjectives
   - hard constraints and context (scale, team, existing stack, deadlines)
   - relevant file paths — the advisor reads them read-only from the repo root
   - for a stuck bug: symptoms, what was ruled out and how, exact errors
   - an explicit ask: the concrete flaws, failure modes and false assumptions in
     each option, each tied to a file, fact or scenario you can check — no
     recommendation or ranking

3. **Call the advisor.** One `mcp__pi__advise` call: `cwd` = repo root, `brief` =
   the brief. The response opens with a `threadId:` line — use `mcp__pi__reply`
   on it only to ask for the evidence behind a claim, never to argue a position:
   the advisor concedes under pushback, so a concession carries no information.

4. **Synthesize and report.** Each advisor claim, marked verified, refuted or
   unverifiable against the code; adopt only verified ones and say what you had
   missed. Then your final recommendation, owning the decision.
