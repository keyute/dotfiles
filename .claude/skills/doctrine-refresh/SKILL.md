---
name: doctrine-refresh
description: Re-validate the empirical claims in the two canonical instruction
  sources — the repo-root AGENTS.md authoring doctrine and the whys in
  docs/agents-baseline.md — against current practitioner consensus: engineers
  running agents in production on forums and engineering blogs, with vendor
  docs as corroboration only. Proposes minimal wording updates where a claim
  is contested or obsolete, and flags baseline principles whose justification
  has collapsed. Use when asked to refresh, re-validate, or fact-check the
  doctrine or baseline, or after major shifts in agent tooling. Edits only on
  confirmation; never commits.
---

Rules and principles are durable intent; their *whys* are empirical claims
about how models follow instructions, and those age. Scope is the two
canonical sources only — projections, subagent and skill bodies inherit
from the baseline through the `agent-instructions-audit` skill, so editing
them here would create a second writer for the same content. Recompute
everything from the files each run — never work from a remembered claim
list.

## Steps

1. **Extract claims.** Read the repo-root `AGENTS.md` "Authoring agent
   instructions" section and `docs/agents-baseline.md`; list every
   empirical claim — each *why* and each asserted model behavior (budget
   sharing, under-triggering, phrasing and emphasis effects, context
   degradation, and whatever else the current text asserts).

2. **Research.** For each claim, gather current practitioner evidence:
   Exa MCP for Reddit/HN/forum threads, plus engineering blogs of
   people running agents in production. Filter hard for credibility —
   specific failure stories, measured before/after observations, sustained
   production use; discard listicles, template dumps, and engagement bait.
   Use vendor docs and published evals only to corroborate. Delegate the
   sweep to subagents so only distilled findings enter context.

3. **Classify.** Per claim: supported / contested / obsolete, each with a
   one-line evidence summary and source. Where a claim weakened but its
   rule stays harmless, prefer keeping the rule and updating only the why.
   Where a baseline principle's justification has collapsed, do not edit
   the principle — flag it as an intent decision for me, with the
   evidence; the baseline changes only when my intent does.

4. **Codex second opinion.** The doctrine steers Codex as much as Claude,
   and a same-model reviewer shares the classifier's blind spots. Load the
   codex MCP if needed (ToolSearch
   `select:mcp__codex__codex,mcp__codex__codex-reply`); one call — sandbox
   read-only, approval policy never, cwd = repo root, config override
   `{"model_reasoning_effort": "high"}` — carrying the claim list, each
   classification with its evidence summary, and the draft rewordings.
   Ask it to dispute any classification or wording that misreads how
   models actually follow instructions. Verify disputes against the
   gathered evidence, adjust what holds, and report remaining
   disagreement instead of looping. If the codex MCP is unavailable, mark
   the second opinion skipped and continue.

5. **Report, then edit only on confirmation.** Emit the classification and
   a minimal diff for each contested or obsolete why — wording held to the
   doctrine's own gates and style. On confirmation, apply and stop; if a
   baseline why changed, note that the `agent-instructions-audit` skill
   propagates wording downstream. Never commit or stage.
