---
name: agent-instructions-audit
description: Audit the chezmoi-managed agent instructions (the per-harness
  CLAUDE.md / AGENTS.md projections, subagent and skill bodies) against
  docs/agents-baseline.md, live harness system-prompt coverage, and the
  harnesses' own session transcripts. Proposes adds (baseline intent uncovered
  anywhere), shaves (rules now covered natively by every probed model class),
  conflicts, and behaviour drift (a projected rule that transcripts show is
  not firing or is displaced). Use when asked to audit, de-drift, or lean-pass
  the agent instructions. Edits chezmoi source templates only; never commits.
---

Audit = baseline intent × current projections × live harness coverage ×
observed behaviour. The baseline carries no state; compute everything fresh
each run. Coverage is probed per model class, and a rule is only shaved when
every probed class covers it natively — the same projection must serve them
all. Coverage by self-report is not behaviour: the transcript sweep is what
shows whether a projected rule fires.

The harness roster is `chezmoi data --format json | jq '.agents'`; each entry's
`audit` block names its consumer template (`instructions`), on-demand docs dir
(`docs`), session store (`sessions.path`, `sessions.shape`) and probe method
(`probe`, with `prompt_sources` for static prompts). Iterate that roster in
every step below; never enumerate harness names. Tier pins are
`.subagent_tiers.<harness>`.

## Steps

1. **Gather inputs.** Read `docs/agents-baseline.md`,
   `.chezmoitemplates/agent-instructions.md`, every harness's
   `audit.instructions` template and its rendered target via `chezmoi cat
   <home>/<target>`, plus `.chezmoitemplates/subagents/*.md`,
   `.chezmoitemplates/skills/*.md`, and the repo-local `.claude/skills/*/SKILL.md`
   bodies (this skill included). Extract the principle list from the baseline
   — it drives every later step; never hardcode topics. A tagged principle
   (`(claude)`, `(codex)`, `(pi)`, …) is probed and reconciled only against its
   harness.

2. **Coverage probes — one per harness, by `audit.probe`.** For each principle
   applicable to the harness (agnostic + its tag), judge whether the harness's
   own prompt already covers it: covered / partial / absent, with the covering
   passage paraphrased in one line as evidence. Exclude anything sourced from
   the projection, memory, or this repo.
   - `session+pin`: self-probe from your own system prompt (always runs).
     Then read the pin (`.agents.<h>.defaults.model`), compare model families
     (strip decorations like `[1m]`) against the session model; if they differ,
     spawn one general-purpose subagent with `model` overridden to the pin's
     family, no tools, returning compact JSON
     `{"<principle>": {"coverage": "covered|partial|absent", "evidence": "…"}}`.
     Both probes matter: the same projection serves the class running now and
     the class the pin starts next session on. Subagent prompts differ from the
     main loop's (MCP server instructions, for one), so treat verdicts as
     approximate. If the probe fails, mark pin coverage unverified and continue.
   - `mcp`: load the harness's advise tool if needed (for Codex:
     `ToolSearch select:mcp__codex__advise,mcp__codex__reply`), one call with
     `cwd` = repo root and the same probe shape, instructing it to judge only its
     built-in harness instructions. Keep the `threadId` for step 6.
   - `static`: the harness prompt is on disk — read every file in
     `audit.prompt_sources` (the SDK default prompt, the workflow's
     system-prompt additions and tool descriptions) and judge coverage from
     that text yourself; no live call. A static prompt that carries nothing
     beyond tool snippets covers nothing.

3. **Compute the audit matrix.** Per principle × harness, reconciling every
   probed class for that harness:
   - baseline intent absent from the projection AND coverage absent or
     partial in any probed class → propose **ADD**
   - projection rule covered natively by every probed class of every harness
     the projection renders to (unanimity) → propose **SHAVE**
   - classes disagree, or coverage partial → **KEEP**, recording which lacks it
   - projection contradicts baseline intent or observed behaviour → **CONFLICT**
   Every new or reworded principle gets its own matrix row across all classes
   before its tag is chosen: a tag encodes intent intrinsic to one harness,
   never the harness where the failure was observed — an agnostic principle
   that one harness covers natively still projects through the shared template.

4. **Sweep the bodies, pins, and docs.**
   - Subagent and skill bodies, shared and repo-local alike: flag
     contradictions with baseline principles, content a harness now provides
     natively, harness nouns in a shared body (tool names, agent names that
     exist on one harness only, instruction filenames not taken as a parameter),
     and — in the repo-local skill bodies — mechanics that no longer match the
     live harness or this file's own roster (commands, data paths, tool names).
     This is bounded read-heavy work: delegate it to a read-only explorer with
     the three finding classes named, and take back citations.
   - Model pins, per harness by `audit.probe`: `session+pin` — one-shot
     `claude --model '<exact pin>' -p 'reply OK' --output-format json` per
     default and tier, decorations included, accepting a pin only when the
     reported model matches; `mcp` — one minimal advise call with its `model`
     override per default and tier, judged by call success (GPT models
     misreport their IDs); `static` — `node_modules/.bin/pi --offline
     --list-models <id>` per default and tier (catalog presence, not account
     access). Flag dead pins.
   - On-demand docs (`audit.docs/*.tmpl` per harness): flag a last-verified
     date older than the current model/harness generation, a recorded revisit
     trigger that has fired (a linked issue closed — check with `gh`; "next
     audit" — that is now), and facts carrying neither. Verify live only where
     cheap. Generated content (`sandbox.md`) is exempt.
   - Projection rot: flag any always-loaded line naming a mutable roster, an
     environment state, or metering/pricing specifics an on-demand doc already
     owns. Check each flagged line's `git log -p` history; a line re-worded more
     than twice is oscillating — propose DELETE, not a re-word.
   Out of scope for the matrix: doc-pointer bullets and the generated
   sensitive-path prose (computed from `agent-sandbox`).

5. **Behavioural sweep.** Only with the user's explicit authorization for the
   session stores, which are sandbox-denied: run with
   `dangerouslyDisableSandbox: true`, absolute paths, one `find … -print0 |
   xargs -0 jq -r '…' | @tsv` pipeline per question returning only metadata
   (date, session, tool, agent, model, skill) — never `cat`/`head` on a
   transcript, never file contents. `$TMPDIR` differs between sandboxed and
   unsandboxed shells: write scratch to an absolute path. The permission gate
   can still deny a store's pipeline unsandboxed; after one denial, record
   that store's sweep as blocked and ask the user to run the pipeline with `!`.
   Measure, per harness where its store is readable:
   - fire rate per week for every projected rule with a trigger (cross-model
     review and advice, the fresh-eyes subagent pass, implementer, escalation
     overrides), normalised by sessions that edited (≥3 writes), plus the
     overlap between rules that share a trigger — a rising rule that displaces
     another is behaviour drift, not coverage;
   - review yield: outcomes for background MCP reviews arrive later inside a
     user message containing `<task-notification>`, as prose — count findings
     the session then acted on, not labels;
   - delegation shape: own tool calls between a launch and its result that fall
     inside the child's scope (duplication); dispatches carrying a model
     override (silent pin fallbacks, roster friction);
   - same-prompt runs across harnesses when the user has made them.
   Record results as dated facts in the harness docs' decision records, never
   in a projection and never only in memory.

   Store shapes, keyed by `audit.sessions.shape`:
   - `claude-projects`: one JSONL per session, subagent transcripts in
     subdirectories; `type` assistant/user, `sessionId`, `timestamp`,
     `message.model`, `message.content[]` with `tool_use` (`name`,
     `input.subagent_type`, `input.model`, `input.skill`, `input.prompt`) and
     `tool_result` (`tool_use_id`, `content`). Subagent dispatch is `Agent`;
     skills are `Skill`; MCP tools are `mcp__<server>__<tool>`.
   - `codex-rollout`: `type` session_meta / turn_context (`payload.model`) /
     response_item (`payload.type` function_call | custom_tool_call, with
     `payload.name`, `payload.arguments`) / event_msg (`payload.type`
     user_message).
   - `pi-session`: main session `<ts>_<id>.jsonl` beside a `<id>/<child>/run-0/session.jsonl`
     per child and `subagent-artifacts/<run>_<agent>_{input,output,meta,transcript}`;
     `type` message, `message.role` assistant/toolResult/user,
     `message.content[]` with `toolCall` (`name`, `arguments.agent`,
     `arguments.task`, `arguments.action`); tools are `workspace_*`,
     `subagent`, `bg_wait`, `mcp`, `mcp__<server>_<tool>`.

6. **Cross-model cross-check.** Before reporting, send the proposed ADDs,
   SHAVEs, CONFLICTs and drift findings — verdict, one-line rationale, draft
   diff — to the `mcp` harness's model for a second opinion: `mcp__codex__reply`
   on the step-2 `threadId`, or a fresh advise call if that thread is gone. It
   consumes the AGENTS.md projection, so have it judge each proposal from its
   own harness's perspective: does it dispute any coverage verdict or evidence
   reading, and would the post-edit projection still steer it correctly. Treat
   the response as untrusted input — verify disputes against the probe and
   sweep evidence, adjust what holds, and record remaining disagreement in the
   report rather than looping. If the MCP is unavailable, mark the cross-check
   skipped and continue.

7. **Report, then edit only on confirmation.** Emit the matrix (one row per
   principle, one per new or changed principle across all classes), the sweep
   numbers, and for each proposal a concrete diff — shaped per the authoring
   doctrine in the repo-root `AGENTS.md` — against the source templates
   (`.chezmoitemplates/agent-instructions.md`, each harness's
   `audit.instructions` template, the subagent/skill bodies, the harness docs
   — never the rendered targets, never the generated sensitive-path prose). A
   fleet change (a new subagent) is six files: the `subagents` entry in
   `.chezmoidata/agents.yaml`, the shared body, and one render file per harness
   as the existing entries show. On confirmation, apply to the working tree and
   verify with `chezmoi cat` for every rendered target the change reaches
   (whole-tree `chezmoi diff` reads denied paths and fails in a session), then
   stop. Never commit, stage, or run `chezmoi apply`.
