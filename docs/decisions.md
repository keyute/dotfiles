# Harness decisions

Sole owner of each live harness decision's why and reversal event; a
superseded row is deleted (git keeps history). Key: the agents.yaml data path
where one exists (a list-valued path may carry one sub-label), else a
`parity.`, `setting.`, `measure.` or `instruction.<principle>` label. Why:
opens with its evidence kind — measured (a reading or replay here), vendor
(doc or system card), benchmark (third-party; nominates only), preference
(owner's choice), forced (harness or vendor left no option). Revisit when: an
event noticed in use — a model release or retirement, a CLI or pi release, a
red test, an observed failure, a harness blocking a session on its weekly
limit ("the pool binds") — never a date or a reading nobody takes. Values
live in agents.yaml: a row names a tier, never a pin or a model family; a
re-pin edits only the row whose evidence was about the old pin.

## Events

A release moves a pin, never the layout: the tier set (small/top/frontier),
which tier drives, the classifier and search tiers, and each role's tier and
effort change only on their own row's event, as their own change after the
re-pin has landed.

- **Successor or retirement.** Confirm the model is live: `claude --model
  <id> -p 'reply OK' --output-format json`, or listed in
  `node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`;
  else bump the SDK first, alone. Edit the tier in `subagent_tiers`; on
  Claude, `no_effort_models` if the pin has no effort knob. Read the tier's
  row: evidence about the old pin (a benchmark, a cap, a catalog fact) is
  rewritten for the new one, a family-level why stays. `npm run test:pi`,
  `chezmoi diff`; re-confirm live after apply.
- **New family.** As above; then read the vendor's prompting guide for the
  pin and, for each `model:`-tagged line in
  `.chezmoitemplates/agent-instructions.md`, delete the line if every pinned
  tier on both harnesses now behaves so natively or the guide warns against
  the steer. Add nothing in this pass.
- **Claude Code release** (brew, unpinned): a per-call `Agent(model:…)` that
  slips through, or a native_coverage line missing from the prompt → fix that
  key.
- **pi or plugin bump** (the dependabot `pi` PR): a red stability pin on a
  surface with a *Fallback* → delete the surface unless `docs/pi-coupling.md`
  lists it under Repair; otherwise repair.
- **The pool binds.** Lower that driver's effort, then its tier, per its row.

## Decisions

| key | why | revisit when |
|---|---|---|
| subagent_tiers.claude.small | vendor: the lineup's small model | a small successor ships or the pin retires → same-family successor |
| subagent_tiers.claude.top | benchmark: AA $/task (2026-09-25) nominated it; no paired replay | a top successor ships or the pin retires → re-pin; an unattended text-only turn ends → the previous top pin |
| subagent_tiers.claude.frontier | preference: escalation-only under its 50% weekly cap | the cap is lifted → re-open the driver; a successor ships → re-pin |
| subagent_tiers.pi.small | benchmark: matches the previous small at 0.4× cost per task | leaves the pinned catalog → re-pin |
| subagent_tiers.pi.top | benchmark: beats the previous top with fewer tokens | leaves the catalog → re-pin |
| subagent_tiers.pi.frontier | vendor: OpenAI rates it at low effort above the top pin at high | leaves the catalog → re-pin |
| agents.claude.defaults.tier | preference: top at effort high; the frontier tier stays escalation-only under its weekly cap | the Claude pool binds → lower effort, then tier |
| agents.pi.defaults.tier | benchmark: frontier at effort high is cheaper per task (AA Terminal-Bench) than lower effort | the pi pool binds → lower effort, then tier |
| agents.pi.defaults.classifier | vendor: top tier for both stages on its system card's injection defence, filter off, judge medium | an observed false allow, or false denies blocking work → re-judge; the pi pool binds → judge low, then a cheaper tier |
| agents.claude.denied_tools.models | measured: the Agent enum (CLI 2.1.282) has one alias with no tier; the frontier alias renders from its pin; pi refuses non-tier children (children.mjs); Workflow agent() opts.model is instruction-guarded | a CLI release adds an untiered alias, or permission rules see Workflow agents → extend the deny |
| agents.pi.search_tier | preference: each search is one extra request on the pool, so the small tier | an observed search miss the top tier catches → top |
| setting.native_coverage | measured: each covered line is in the CLI 2.1.282 driver prompt and its subagent prompt, or pi's subagent-tool-description; initiative is driver-prompt only, and a child cannot check back anyway | a release whose prompt lacks a covered line → unshave that key |
| agent_mcp_servers.pi.args | preference: review and advice are recall-critical, so `--reasoning-effort high` | three consecutive reviews with only trivial findings → medium |
| measure.role_matrix | preference: top/medium default; lookups lower, recall-critical roles higher (values in agents.yaml) | an observed Explore miss → medium; a lens miss a later review catches → high; a small re-pin → probe a role at small |
| parity.researcher_no_bash | forced: the network allowlist lacks upstream release-note hosts; WebFetch/WebSearch reach them, curl fails confusingly | the allowlist covers upstream hosts, or a fetch tool fails on them → Bash |
| subagents.infra-reviewer | preference: chart/CRD/GitOps hazards are not inferable from surrounding manifests | a manifest review where diff-reviewer's lens finds the same hazards → fold in |
| subagents.diff-reviewer | preference: one any-language reviewer; the go/python/ts/shell presets were generic checklists dispatched only by ship-check | a shipped language-specific defect the correctness lens missed → restore that preset |
| parity.claude_readonly_bash | forced: Claude has no per-subagent sandbox, so read-only roles can write in cwd via Bash; the tools list enforces | Claude ships a per-subagent sandbox |
| parity.commit_push | forced: Claude prefix-denies commit/push (prefix rules cannot express pi's gh read-shape exception); pi classifier + confirm (policy.mjs REVIEWED/GH_READ) | an unreviewed Claude remote mutation → ask rules for unambiguous verbs |
| parity.cross_model | preference: review/advice Claude→pi only (the reverse would spend the Anthropic pool); rostered children lose the bridge by tool list or disallowedTools; pi has no bridge | the pi pool binds while the Claude pool does not → reverse |
| parity.harness_intrinsic | forced: Claude memory and the Plan agent have no pi counterpart | a harness ships the other's feature |
| parity.workflow_scripts | preference: one deterministic orchestration surface (Claude Workflow, worktree isolation); pi refuses scripts, chains and worktree children (children.mjs) | pi-subagents ships script-driven runs with structured outputs → port |
| parity.mcp_sandbox | forced: Claude's sandbox covers Bash only, so its MCP servers run unsandboxed; pi runs them in SRT except Playwright, and its allowlist lets pi Bash reach MCP hosts | Claude sandboxes MCP servers |
| parity.pi_sandbox_paths | forced: bash 3.2 heredocs need a writable /var/tmp and pi read-only roles have no writable cwd; the agent dir and ~/.zshrc are write-denied as live code | pi read-only roles gain a writable cwd, or /bin/bash ≥ 4 |
| parity.git_metadata | preference: pi write-denies all of .git (policy.mjs), Claude protects hooks, config and worktree metadata only; the owner stages and commits | a pi task fails for want of git add or branch creation → narrow to Claude's list |
| parity.model_shell | preference: pi's model shell is bash -c without rc (zsh would load the interactive rc into every sandboxed call); Claude runs the user's zsh | a model command fails for want of a zsh function or PATH entry |
| parity.web_tools | forced: pi-web-search ships search only, so Exa is WebFetch's counterpart; Claude Bash alone reaches *.anthropic.com and code.claude.com (its own docs and API) | pi's search plugin ships fetch → drop the Exa mapping |
| agents.claude.plugins | preference: frontend-design is a Claude plugin; UI work happens in Claude | a pi UI task → shared skill stub |
| setting.local_only_surface | preference: Claude: claude.ai surfaces, cron and remote tools off, denied_tools, DISABLE_TELEMETRY; pi: enableInstallTelemetry off, PI_SKIP_VERSION_CHECK (the dependabot pi group signals releases) | a surface is wanted → reverse per entry; a release renames a key |
| agents.claude.skill_overrides | preference: ship-check covers simplify and code-review; init, keybindings-help, update-config are user-driven; fewer-permission-prompts needs denied transcripts; chrome, schedule, design-sync are remote; no dataviz | an observed need → reverse per entry |
| setting.workflowSizeGuideline | measured: workflows were 62.3% of top-tier units (30 days to 2026-09-28) with unguided runs of 11, 3, 8 agents → small | a workflow stops short of work it needed → unset |
| setting.explore_routing | measured: Explore:explore-deep dispatches 37:99 Claude, 25:120 pi over 45 days → the descriptions steer lookups to Explore | an observed Explore miss on a question routed to it → revert the descriptions |
| setting.hideThinkingBlock | forced: the workflow blanks reasoning itself and its spacer needs pi's native hide off | the spacer stops depending on the native block → unset |
| setting.pi_defaultThinkingLevel | preference: settings own the root level with no per-mode set, so a /thinking choice survives mode switches | an observed need for a plan/execute effort split |
| measure.omitClaudeMd | measured: child first turn 16.2k tokens before; Explore, Plan, researcher and dep-researcher skip the instructions, their bodies need no repo conventions | a named miss traced to missing instruction context → revert for that role |
| instruction.cross_model_review | benchmark: ≈30 real findings in 20 reviews on the retired Codex backend, unmeasured on pi; the trigger lives in the skill description, loaded only where the Skill tool is | three consecutive reviews with only rejected findings → narrow the trigger |
| instruction.scope_of_extras | measured: pi-side replay arms shipped 2.8–3.5× the tests; no reversible-change test ban yet | a shipped diff carries unrequested tests after a model release → the vendor's no-tests-for-reversible-changes line |
| measure.single_writer | measured: implementer median 17 calls per dispatch (2026-09-26); the only write-capable specialist | implementer dispatches run out of turns or deadline on bounded slices → a second write-capable specialist |
| measure.pi_second_vendor | measured: children 25% of root+child pi spend; a weaker substitute repays its saving through repairs | the pi pool binds with children ≥30% of spend → OpenCode Go for explore-deep |
| parity.env_scrub | forced: pi strips secret-named and pre-sandbox-hook env vars from sandboxed commands (sandbox-runner.mjs); Claude's env scrub would also strip op-injected MCP keys | the scrub gains a per-target or allowlist knob → set it |
| parity.subagent_deadline | forced: pi children stop at timeoutMs with a checkpoint steer (extensions/subagent/config.json); Claude has no per-subagent deadline | Claude ships a subagent deadline → set both from one value |
| parity.cli_versioning | forced: Claude runs the brew cask, which cannot pin; pi is lockfile-pinned because it breaks extension APIs across 0.x | a CLI release breaks an alias deny or a native_coverage line → fix that key |
