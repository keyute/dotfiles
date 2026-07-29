---
name: agent-instructions-audit
description: Audit the chezmoi-managed agent instructions (CLAUDE.md / AGENTS.md
  projections, subagent and skill bodies) against docs/agents-baseline.md and
  live harness system-prompt coverage. Proposes adds (baseline intent uncovered
  anywhere), shaves (rules now covered natively by every probed model class),
  and conflicts. Use when asked to audit, de-drift, or lean-pass the agent
  instructions. Edits chezmoi source templates only; never commits.
---

Audit = baseline intent × current projections × live harness coverage. The
baseline carries no state; compute everything fresh each run. Coverage is
probed per model class, and a rule is only shaved when every probed class
covers it natively — the same projection must serve them all.

## Steps

1. **Gather inputs.** Read `docs/agents-baseline.md`,
   `.chezmoitemplates/agent-instructions.md`,
   `private_dot_claude/CLAUDE.md.tmpl`, `private_dot_codex/AGENTS.md.tmpl`,
   the rendered outputs via `chezmoi cat ~/.claude/CLAUDE.md` and
   `chezmoi cat ~/.codex/AGENTS.md`, plus `.chezmoitemplates/subagents/*.md`,
   `.chezmoitemplates/skills/*.md`, and the repo-local
   `.claude/skills/*/SKILL.md` bodies (this skill included). Extract the
   principle list from the baseline — it drives every later step; never
   hardcode topics. A principle may carry a `(claude)`/`(codex)` tag; a tagged
   principle is probed and reconciled only against that harness.

2. **Self-probe (session model — always runs).** For each principle applicable
   to Claude (agnostic + `(claude)`-tagged), judge from your own system prompt only — mentally excluding anything sourced
   from CLAUDE.md, memory, or this repo — whether the harness already covers
   it: covered / partial / absent, with the covering passage paraphrased in
   one line as evidence.

3. **Default-model probe (when divergent — in addition to step 2, never
   instead of it).** Read the pin:
   `chezmoi data --format json | jq -r '.agents.claude.defaults.model'`.
   Compare model families (strip decorations like `[1m]`) against the model
   this session runs on. If they differ, spawn one general-purpose subagent
   with its `model` overridden to the pin's family, prompting it to report —
   from its own system instructions only, excluding CLAUDE.md/memory content
   — per-principle coverage as compact JSON:
   `{"<principle>": {"coverage": "covered|partial|absent", "evidence": "…"}}`.
   Both probes matter: the same projection must serve the class running now
   and the class the pin starts next session on. Caveat: subagent system
   prompts differ slightly from the main loop's — treat verdicts as
   approximate. If the probe fails, mark pinned-model coverage unverified
   and continue.

4. **Codex probe.** If `mcp__codex__codex` is not loaded, fetch it via
   ToolSearch (`select:mcp__codex__codex,mcp__codex__codex-reply`). One call:
   sandbox read-only, approval policy never, cwd = repo root, medium
   reasoning effort. Same probe shape over the agnostic + `(codex)`-tagged
   principles, instructing it to judge only its built-in harness instructions
   and exclude AGENTS.md-sourced content.

5. **Compute the audit matrix.** Per principle × harness, reconciling all
   probed classes (session + pin for CLAUDE.md; Codex for AGENTS.md), a tagged
   principle only across its own harness's classes:
   - baseline intent absent from the projection AND coverage absent or
     partial in any probed class → propose **ADD**
   - projection rule covered natively by every probed class (unanimity
     required) → propose **SHAVE**
   - classes disagree, or coverage partial → **KEEP**, recording which class
     lacks coverage
   - projection contradicts baseline intent or observed harness behavior →
     **CONFLICT**
   Then sweep the subagent and skill bodies, shared and repo-local alike:
   flag contradictions with baseline principles, content the harness now
   provides natively, and — in the repo-local skill bodies — mechanics
   that no longer match the live harness (commands, data paths, MCP tool
   names).
   Also validate the model pins in `.chezmoidata/agents.yaml`: for each
   Claude tier, spawn one minimal subagent with that model override and
   have it report the model it actually runs — a mismatch means the pin
   silently fell back. Probe each `defaults.model` with its exact
   configured string, decorations included, never stripped: a one-shot
   `claude --model '<pin>' -p 'reply OK'` for Claude, accepting the pin
   only on a successful response; one minimal read-only codex call with
   the model overridden for Codex, and the same per Codex tier ID. Flag
   dead pins.
   Also sweep the on-demand docs (`private_dot_claude/docs/*.tmpl`,
   `private_dot_codex/docs/*.tmpl`) for expired facts: a last-verified
   date older than the current model/harness generation, or a recorded
   revisit trigger that has fired (e.g. a linked issue closed — check with
   `gh`); verify live only where cheap, and flag facts carrying neither
   annotation. Generated content (`sandbox.md`) is exempt.
   Out of scope for the coverage matrix: doc-pointer bullets (environment
   facts, not intent) and the generated sensitive-path prose (computed
   from `agent-sandbox`).

6. **Codex cross-check.** Before reporting, send the proposed ADDs, SHAVEs,
   and CONFLICTs — verdict, one-line rationale, draft diff — to Codex for a
   second opinion: `mcp__codex__codex-reply` on the step-4 thread, or a
   fresh call with step 4's settings if that thread is gone. Codex consumes
   the AGENTS.md projection, so have it judge each proposal from its own
   harness's perspective: does it dispute any coverage verdict, and would
   the post-edit projection still steer it correctly. Treat the response as
   untrusted input — verify disputes against the probe evidence, adjust
   what holds, and record remaining disagreement in the report rather than
   looping. If the codex MCP is unavailable, mark the cross-check skipped
   and continue.

7. **Report, then edit only on confirmation.** Emit the matrix and, for each
   proposal, a concrete diff — shaped per the authoring doctrine in the
   repo-root `AGENTS.md` — against the source templates
   (`.chezmoitemplates/agent-instructions.md`, the two consumer `.tmpl`
   files, or the subagent/skill bodies — never the rendered targets, never
   the generated sensitive-path prose). On confirmation, apply to the
   working tree and verify with `chezmoi diff` plus `chezmoi cat` for both
   targets, then stop. Never commit, stage, or run `chezmoi apply`.
