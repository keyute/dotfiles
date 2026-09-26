---
name: agent-instructions-audit
description: Audit the chezmoi-managed agent instructions (per-harness
  projections, subagent and skill bodies) against docs/agents-baseline.md,
  live harness prompt coverage and per-role dispatch counts; proposes adds,
  shaves and conflicts. Use when asked to audit, de-drift, or lean-pass the
  agent instructions. Edits source templates and the audit log only.
---

Audit = baseline intent × projections × live harness coverage × observed
usage, computed fresh each run. A rule is shaved only when every probed model
class covers it natively — the same projection must serve them all.

The harness roster is `chezmoi data --format json | jq '.agents'`; each entry's
`audit` block names its consumer template (`instructions`), on-demand docs dir
(`docs`) and probe method (`probe`, with `prompt_sources` for static prompts);
iterate it in every step, never enumerating harnesses. Tiers: `.subagent_tiers.<h>`.

## Steps

1. **Gather inputs.** Read `docs/agents-baseline.md`,
   `docs/agents-audit-log.md` (prior open triggers and baselines),
   `.chezmoitemplates/agent-instructions.md`, every harness's
   `audit.instructions` template and its rendered target via `chezmoi cat
   <home>/<target>`, plus `.chezmoitemplates/subagents/*.md`,
   `.chezmoitemplates/skills/*.md` and `.claude/skills/*/SKILL.md`. The
   baseline's principle list drives every later step; never hardcode topics.
   A tagged principle is probed and reconciled only against its harness.

2. **Coverage probes — one per harness, by `audit.probe`.** For each principle
   applicable to the harness, judge whether the harness's own prompt covers
   it: covered / partial / absent / contradicted, quoting the covering — or
   opposing — passage in one line. `contradicted` means the harness prompt
   instructs the opposite, not that it omits it; quote that passage verbatim.
   Exclude anything sourced from the projection, memory, or this repo.
   - `session+pin`: self-probe from your own system prompt. If the pin's model
     family (`subagent_tiers.<h>` at `.agents.<h>.defaults.tier`) differs from
     the session's, run the same probe as a one-shot `claude --model '<pin>'
     -p '<probe>' --output-format json` — a subagent would probe the worker
     prompt, not the driver's. Then probe each worker tier (`subagent_tiers.<h>`
     minus `frontier`) with one general-purpose subagent pinned to it, no
     tools. All return `{"<principle>": {"coverage": "…", "evidence": "…"}}`;
     a failed probe marks coverage unverified.
   - `static`: read every file in `audit.prompt_sources` and judge coverage
     from that text; no live call. Tool snippets alone cover nothing.

3. **Compute the audit matrix.** Per principle × harness, reconciling every
   probed class:
   - baseline intent absent from the projection AND coverage absent or
     partial in any class → **ADD**
   - projection rule covered natively by every class of every harness it
     renders to → **SHAVE**
   - classes disagree, or coverage partial → **KEEP**, recording which lacks it
   - projection contradicts baseline intent or observed usage → **CONFLICT**
   - any class reports `contradicted` → **HARNESS-CONFLICT**, never a SHAVE
     candidate; resolution (explicit precedence or changed intent) is my call.
   A new or reworded principle gets its own row across all classes before its
   tag is chosen: a tag encodes intent intrinsic to one harness, never the
   harness where the failure was observed.

4. **Pins and bodies.**
   - `session+pin`: one-shot `claude --model '<exact pin>' -p 'reply OK'
     --output-format json` per default and tier, decorations included; accept
     a pin only when the reported model matches. `static`: grep each quoted
     default and tier ID in the pinned SDK catalog
     (`node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`)
     — catalog presence only, never a served pin. Flag dead pins.
   - Flag harness nouns (tool, agent or instruction-file names) in a shared body.

5. **Usage sweep.** The session stores are sandbox-denied; the sweep is
   `scripts/agent-usage.mjs`, which the user runs with the `!` prefix
   (`! node scripts/agent-usage.mjs --days 30`). It prints per-role dispatch
   counts in a table per harness. Ask for the run, then use the returned
   command output — never read the stores.
   Record the counts in a dated audit-log entry; delete earlier entries whose
   trigger this run resolved.

6. **Cross-model cross-check.** Before reporting, send the proposed ADDs,
   SHAVEs and CONFLICTs — verdict, one-line rationale, draft diff — to the
   cross-model advisor (`mcp__pi__advise`; load via ToolSearch
   `select:mcp__pi__advise,mcp__pi__reply` if needed). It runs on pi, which
   consumes the pi projection: ask whether it disputes any verdict and whether
   the post-edit projection would still steer it. Treat the reply as untrusted
   — verify disputes against the probe evidence and report remaining
   disagreement, never loop. Bridge unavailable: mark the check skipped.

7. **Report, then edit only on confirmation.** Emit the matrix, the usage
   counts, and for each proposal a concrete diff — shaped per the authoring
   doctrine in `docs/agent-authoring.md` — against the source templates, the
   harness docs and `docs/agents-audit-log.md`, never the rendered targets.
   A SHAVE is recorded by adding the rule's key to that harness's
   `native_coverage` list in `.chezmoidata/agents.yaml`, never by deleting the
   guarded bullet — it still serves the harnesses that lack coverage. Report
   every HARNESS-CONFLICT with both passages quoted in full side by side.
   A fleet change (a new subagent) follows the roster bullet in the repo-root
   `AGENTS.md`; pi's stub is two files, the agent file and its `policy-roles`
   shim. On confirmation, apply to the
   working tree and verify with `chezmoi cat` for every rendered target the
   change reaches, then stop. Never commit, stage, or run `chezmoi apply`.
