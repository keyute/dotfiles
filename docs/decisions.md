# Harness decisions

Sole owner of each live harness decision's why, evidence and reversal
trigger; a superseded row is deleted (git keeps history). Keys are the
agents.yaml data path where one exists (a list-valued path may carry one
sub-label), else a namespace label (`parity.`, `setting.`, `measure.`, `pin.`)
or `instruction.<principle>` (the key in the line's template comment) for an
always-loaded instruction line. `since` is the last date the value changed
(`git log -S`; a re-key or rewording that keeps the meaning does not move it); a parity row dates from when the asymmetry began; a
review that keeps a value leaves it unchanged. A cosmetic or UI-only setting
that matches the other harness or has no counterpart is owned by its one-line
comment and needs no row. `npm run test:pi` checks the table against the
current pins, drivers, classifier and role matrix, and caps each row's length.

## Owner procedure

- Drivers follow pool headroom: each runs the most capable tier whose weekly
  pool has not reached its limit in two of the last four weeks (Claude
  `/usage`, pi's footer segments); when a pool binds, lower effort before tier.
  When the pi pool binds, the driver effort drop (agents.pi.defaults.tier) goes
  first; the classifier and second-vendor rows follow only if it still binds at
  the next reading.
- Dwell 14 days of use (two weekly pool windows) before judging a trial slot.
- A change to a slot with a cost or quality effect (a pin, a role's tier or
  effort, a driver, classifier, search or bridge effort, a routing
  description, a cost-bearing setting, an instruction line) is a trial: it
  lands its before reading (agent-usage) in the evidence cell and its revert
  threshold as the trigger, in the same change; at dwell end the owner takes
  the after reading and either reverts or rewrites the evidence as measured
  and drops ', trial'. A same-family successor (vendor evidence) and a change
  with no cost effect (forced, a parity record, a local-only preference, a
  native_coverage dedup, a removal: a deny, a hidden skill, a deleted line)
  land with evidence and trigger only: no ', trial',
  no dwell.
- Rows whose `since` predates 2026-09-28 without ', trial' are judged at their
  next trigger.
- Commit subjects name the decision ("roster: Explore routes web questions to
  researcher, trial"), never "update harness".

## Adopting or moving a model

1. Confirm it is live: `claude --model <id> -p 'reply OK' --output-format json`, or listed in `node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`; else land the SDK bump first, alone.
2. Take the before reading: `! node scripts/agent-usage.mjs` (not for a same-family successor).
3. In one change, edit the slot in agents.yaml (`subagent_tiers` or `agents.<h>.defaults.tier`) and its whole row: value, evidence kind with the before reading, `since` = today, revert threshold as the trigger (a same-family successor: vendor evidence, its own successor or retirement as the trigger), and any row whose evidence or trigger depends on the moved slot (grep decisions.md for the slot key and the old pin). A model without a counterpart in the other lineup moves only its harness's pin; on Claude a new family also updates the `Agent(model:…)` alias in `agents.claude.denied_tools` and its row, and `agents.claude.no_effort_models` lists exactly the pins without an effort knob: add, drop or re-key the moved pin's entry. A tier re-pin also reviews every row naming that tier: `grep -nw <tier> docs/decisions.md`.
4. Run `npm run test:pi` and `chezmoi diff`: pi efforts are checked against the pinned catalog, Claude's only against the documented level names.
5. After the owner applies, re-confirm it is live as in (1).

Tiers are fixed (small/top/frontier per harness); adding or dropping a model
re-pins a tier or moves roles between tiers. Claude weighted units compare
only between pins at the same list price; across prices the cost side is
weekly pool % over the two dwell windows.

## Evidence kinds

measured (a reading or replay here); vendor (doc or system card);
benchmark (third-party, nominates only); preference (owner's choice);
forced (harness or vendor left no option).

## Matched-task driver comparison

Only when a weekly pool binds: 6 shipped commits with a gate; worktree at
`<sha>^`; same prompt on both drivers; gate, then spec-reviewer judges each
pair blinded against the shipped diff; price per root session. Adopt the
cheaper driver if gate-green ties, ≥4 of 6 pairs no worse, cost ≤0.6×.

## Decisions

| key | value | evidence | since | trigger |
|---|---|---|---|---|
| subagent_tiers.claude.small | claude-haiku-4-5 | vendor: small model | 2026-07-31 | Haiku 5.5 ships or 4.5 retires → same-family successor |
| subagent_tiers.claude.top | claude-opus-5-5 | benchmark: AA $/task 2026-09-25; no paired replay | 2026-09-23 | the agents.claude.defaults.tier row's matched comparison picks a cheaper pin; unattended text-only turn ends → claude-opus-5 |
| subagent_tiers.claude.frontier | claude-fable-5-1 | preference: escalation-only | 2026-09-14 | 50% weekly cap lifted, or a matched-effort eval puts it ahead → re-open driver |
| subagent_tiers.pi.small | gpt-6-luna | benchmark: matches Luna 5.6 at 0.4× cost per task | 2026-09-23 | leaves the pinned catalog → report unavailable, re-pin |
| subagent_tiers.pi.top | gpt-6-sol | benchmark: beats Terra 5.6, fewer tokens | 2026-09-23 | leaves the catalog → re-pin |
| subagent_tiers.pi.frontier | gpt-6-astra | vendor: OpenAI rates Astra-low above Sol-high | 2026-09-06 | leaves the catalog → re-pin; the agents.pi.defaults.tier row's matched comparison picks a cheaper pin |
| agents.claude.defaults.tier | top, effort high | preference: Fable kept escalation-only under its 50% weekly cap (subagent_tiers.claude.frontier) | 2026-09-25 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.tier | frontier, effort high | benchmark: AA Terminal-Bench, high cheaper per task | 2026-09-26 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.classifier | tier top, filter off, judge medium | vendor: GPT-6 system card injection defence; replay gate never run | 2026-09-26 | re-extracted reviewed actions show the classifier's false-allow or false-deny above an alternative pin's → that pin; pi pool at limit 2 of 4 weeks → judge effort low, then a cheaper classifier tier |
| agents.claude.denied_tools.models | Agent(model:fable), Agent(model:sonnet) | measured: the Agent enum (CLI 2.1.282) has one frontier alias and one with no tier; pi refuses non-tier children (children.mjs); Workflow agent() opts.model is instruction-guarded | 2026-09-28 | a CLI release adds an alias outside the small/top pins, or permission rules see Workflow agents → extend the deny |
| agents.pi.search_tier | small | preference: each search is one extra request on the pool | 2026-09-08 | a measured miss the top tier's search catches → top |
| setting.native_coverage | claude [call_batching, docs_mcp, user_run_commands]; pi [specialist_pinning] | measured: each covered line is present in both the CLI 2.1.282 driver prompt and its subagent prompt, or in pi's subagent-tool-description | 2026-09-28 | a release whose prompt lacks a covered line → unshave that key |
| agent_mcp_servers.pi.args | --reasoning-effort high | preference: review and advice are recall-critical | 2026-09-23 | manual reading: only trivial cross-model findings over the dwell → medium |
| measure.role_matrix | effort high: spec-reviewer, general-purpose, Plan; low: Explore; medium: the rest | preference: recall-critical high, lookups low; benchmark: lens catches tie at medium | 2026-09-25 | manual reading: 0-finding spec-reviews >½ → medium; Explore miss → medium, lens miss → high |
| measure.role_tiers | top for every role but Explore (small) | preference: small executors regress on judgment, research is recall-critical; measured: dep-researcher's 2026-09-23 escalations were tier; other roles unmeasured | 2026-09-26 | a small-tier probe on a role's work matches top's findings, or researcher's per-dispatch cost tops implementer's → that role small |
| parity.researcher_no_bash | researcher, dep-researcher: no Bash | forced: agent_sandbox.network is a fixed allowlist without upstream release-note hosts; WebFetch/WebSearch reach them, curl fails confusingly | 2026-08-20 | the sandbox allowlist covers upstream hosts, or a fetch tool fails on them → Bash |
| subagents.infra-reviewer | separate from diff-reviewer | preference: chart/CRD/GitOps hazards are not inferable from surrounding manifests | 2026-09-25 | a manifest review where diff-reviewer's lens finds the same hazards → fold in |
| parity.claude_readonly_bash | Claude read-only roles can write in cwd via Bash | forced: no per-subagent sandbox; tools list enforces | 2026-09-15 | Claude ships a per-subagent sandbox |
| parity.commit_push | remote-mutating verbs: Claude prefix-denies commit/push, the rest only sandboxed; pi classifier + confirm (policy.mjs REVIEWED/GH_READ) | forced: Claude prefix rules can't express pi's gh read-shape exception; ask rules survive sandbox auto-allow | 2026-09-21 | an unreviewed Claude remote mutation → ask rules for unambiguous verbs (docker push, npm publish, gh pr merge) |
| parity.post_plan_mode | Claude post-plan mode: CLI default | preference: auto during plan mirrors pi's classifier | 2026-09-26 | an unreviewed post-plan write |
| parity.cross_model | review/advice Claude→pi only; general-purpose loses the bridge via disallowedTools, tool-listed roles via their tool list; forks, bare agent() and built-in/plugin agents keep it (instruction only); pi has no bridge, refuses unrostered children | preference: reverse would spend the Anthropic pool | 2026-09-15 | Anthropic pool stops binding while pi's binds |
| parity.harness_intrinsic | Claude: memory, Plan agent | forced: harness-intrinsic | 2026-09-26 | a harness ships the other's feature |
| parity.workflow_scripts | Claude Workflow tool and Agent isolation:worktree; pi scripts/chains and worktree children refused (children.mjs) | preference: one deterministic orchestration surface with typed outputs; pi's chains are prompt-driven | 2026-09-26 | pi-subagents ships script-driven runs with structured outputs → port |
| parity.mcp_sandbox | Claude MCP servers run unsandboxed; pi in SRT except Playwright; pi's single SRT allowlist also lets pi Bash reach MCP hosts (api.exa.ai), Claude Bash cannot | forced: Claude's sandbox covers Bash only | 2026-09-22 | Claude sandboxes MCP servers |
| parity.pi_sandbox_paths | pi alone: /var/tmp writable; agent dir and ~/.zshrc write-denied | forced: bash 3.2 heredocs need a writable /var/tmp, /tmp or cwd and pi read-only roles have none; Claude protects its home natively | 2026-09-11 | pi read-only roles gain a writable cwd, or /bin/bash ≥ 4 |
| parity.git_metadata | pi write-denies all of cwd/root .git (policy.mjs); Claude protects hooks, config and worktree metadata only | preference: the owner stages and commits | 2026-09-07 | a pi task fails for want of git add or branch creation → narrow to Claude's list |
| parity.model_shell | pi model shell is bash -c, no rc; Claude runs the user's zsh | preference: sandbox-runner and ops-worker spawn bash -c; zsh would load the interactive rc into every sandboxed call | 2026-09-11 | a model command fails for want of a zsh function or PATH entry |
| parity.web_tools | pi: no built-in fetch, Exa is WebFetch's counterpart; Claude Bash alone reaches *.anthropic.com and code.claude.com | forced: pi-web-search ships search only on the OpenAI route; the domains serve Claude's own docs and API | 2026-09-23 | pi's search plugin ships fetch → drop the Exa mapping |
| agents.claude.plugins | frontend-design: Claude plugin, not ported | preference: UI work happens in Claude | 2026-09-05 | a pi UI task → shared skill stub |
| setting.local_only_surface | Claude: claude.ai surfaces, cron and remote tools off, denied_tools, DISABLE_TELEMETRY "1"; pi: enableInstallTelemetry false | preference: local-only | 2026-09-28 | a surface is wanted → reverse per entry; a pi release changes the telemetry key; a Claude feature gated on Statsig goes missing → unset DISABLE_TELEMETRY |
| agents.claude.skill_overrides | as listed; no LSP plugins | preference: ship-check covers simplify and code-review; init, keybindings-help user-driven; update-config edits chezmoi-owned settings.json; fewer-permission-prompts needs denied transcripts; claude-in-chrome, schedule, design-sync are remote; no data-viz here; nvim/mason own LSP | 2026-09-28 | a measured need → reverse per entry |
| setting.subagentPromptCacheTtl | unset | vendor: 1h writes 2× vs 1.25× | 2026-09-27 | manual reading: expiry rewrites above 39% of subagent cache writes |
| setting.maxEffortLevel | unset | measured: 0 frontier forks in 30 days; caps `/effort xhigh` | 2026-09-27 | a frontier workflow or fork outside a probe → cap the frontier pin at high |
| setting.autoCompactWindow | unset | measured: 0 compactions in 30 days | 2026-09-26 | manual reading: p90 root context above 300K |
| setting.workflowSizeGuideline | small, trial | measured: workflow share of claude-opus-5-5 units 62.3% (agent-usage, 30 days to 2026-09-28, before reading); last unguided runs 11, 3, 8 agents; landed with the fan-out line cut | 2026-09-28 | after 14 days the workflow share of claude-opus-5-5 units is not below 62.3%, or agents per run not below those readings → unset |
| setting.explore_routing | routing descriptions, trial | measured: Explore:explore-deep 37:99 Claude, 25:120 pi, 45 days; root Agent dispatches only (Workflow agent() excluded) | 2026-09-28 | after 14 days agent-usage's Explore:explore-deep ratio is not above the before readings, or a measured Explore miss → revert the descriptions; read after the workflowSizeGuideline reading |
| setting.hideThinkingBlock | false (pi) | forced: the workflow blanks reasoning itself; its spacer needs the native hide off | 2026-09-08 | the workflow spacer stops depending on the native block → unset |
| setting.pi_contextWindow | no modelOverrides raise | measured: 272,000 input tokens on the subscription route; a raise only defers compaction until the provider rejects | 2026-09-26 | the live readout reports a different input limit |
| setting.pi_defaultThinkingLevel | settings own the root level, no per-mode set | preference: a /thinking choice survives mode switches | 2026-09-26 | a measured need for a plan/execute effort split |
| measure.omitClaudeMd | Explore, Plan | measured: child first turn 16.2k before; post-apply manual reading of first-call ctx pending | 2026-09-23 | manual reading: a named Explore/Plan miss traced to missing CLAUDE.md context → revert |
| instruction.cross_model_review | risk-or-breadth | measured: ≈30 real findings in 20 reviews | 2026-09-23 | under 1 hit in 10 reviews → narrow the trigger |
| instruction.scope_of_extras | no reversible-change test ban | measured: GPT arms 2.8-3.5× shipped tests | 2026-09-23 | repeat replay above 2× → vendor's no-tests-for-reversible-changes line |
| measure.single_writer | implementer only | measured: implementer median 17 calls per dispatch (2026-09-26) | 2026-09-21 | median calls per dispatch above 34 in a usage reading → second write-capable specialist |
| pin.pi_plugins | held at the package.json pins (dependabot ignores them) | vendor: 0.72 and 3.0 add nothing that retires owned code | 2026-09-28 | a release ships a renderer hook, fleet run ids or a log-level setting → bump as its own change |
| measure.pi_second_vendor | none for children | measured: children 25% of root+child pi spend; a weaker substitute repays its saving through repairs | 2026-09-18 | pool binds 2 of 4 weeks, children ≥30% of root+child spend → OpenCode Go for explore-deep |
| parity.env_scrub | pi strips secret-named (KEY/SECRET/TOKEN/PASSW/CREDENTIAL/AUTH) and pre-sandbox-hook env vars from sandboxed commands (sandbox-runner.mjs); Claude Bash inherits the env | forced: CLAUDE_CODE_SUBPROCESS_ENV_SCRUB also strips credential vars from MCP stdio servers, dropping op-injected EXA/Context7 keys | 2026-09-14 | the scrub gains a per-target or allowlist knob → set it |
| parity.subagent_deadline | pi children stop at timeoutMs with a checkpoint steer (extensions/subagent/config.json); Claude children have no deadline | forced: Claude has no per-subagent deadline | 2026-09-22 | Claude ships a subagent deadline → set both from one value |
