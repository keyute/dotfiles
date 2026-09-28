# Harness decisions

Sole owner of each live harness decision's why, evidence and reversal
trigger; a superseded row is deleted (git keeps history). `npm run test:pi`
checks the table against the current pins, drivers and classifier, and caps
each row's length.

## Owner procedure

- Drivers follow pool headroom: each runs the most capable tier whose weekly
  pool has not reached its limit in two of the last four weeks (Claude
  `/usage`, pi's footer segments); when a pool binds, lower effort before tier.
- Dwell 14 days of use (two weekly pool windows) before judging a changed slot.
- Commit subjects name the decision ("roster: Explore routes web questions to
  researcher, trial"), never "update harness".

## Adopting or moving a model

1. Confirm it is live: `claude --model <id> -p 'reply OK' --output-format json`, or listed in `node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`; else land the SDK bump first, alone.
2. Edit the slot in agents.yaml (`subagent_tiers` or `agents.<h>.defaults.tier`) and its row's value cell below, one slot per change; a model without a counterpart in the other lineup moves only its harness's pin.
3. Run `npm run test:pi` and `chezmoi diff`; an unsupported effort fails.
4. After the owner applies, confirm the new pin as in (1), then fill the row: before reading (`scripts/agent-usage.mjs`), evidence kind, revert threshold.

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
| subagent_tiers.claude.small | claude-haiku-4-5 | vendor: small model | 2026-09-25 | Haiku 5.5 ships or 4.5 retires → same-family successor |
| subagent_tiers.claude.top | claude-opus-5-5 | benchmark: AA $/task 2026-09-25; no paired replay | 2026-09-25 | the agents.claude.defaults.tier row's matched comparison picks a cheaper pin; unattended text-only turn ends → claude-opus-5 |
| subagent_tiers.claude.frontier | claude-fable-5-1 | preference: escalation-only | 2026-09-25 | 50% weekly cap lifted, or a matched-effort eval puts it ahead → re-open driver |
| subagent_tiers.pi.small | gpt-6-luna | benchmark: matches Luna 5.6 at 0.4× cost per task | 2026-09-23 | leaves the pinned catalog → report unavailable, re-pin |
| subagent_tiers.pi.top | gpt-6-sol | benchmark: beats Terra 5.6, fewer tokens | 2026-09-23 | leaves the catalog → re-pin |
| subagent_tiers.pi.frontier | gpt-6-astra | vendor: OpenAI rates Astra-low above Sol-high | 2026-09-23 | leaves the catalog → re-pin; the agents.pi.defaults.tier row's matched comparison picks a cheaper pin |
| agents.claude.defaults.tier | top, effort high | forced: the frontier pin is escalation-only under its 50% weekly cap (subagent_tiers.claude.frontier) | 2026-09-25 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.tier | frontier, effort high | benchmark: AA Terminal-Bench, high cheaper per task | 2026-09-26 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.classifier | tier top, filter off, judge medium | vendor: GPT-6 system card injection defence; replay gate never run | 2026-09-26 | re-extracted reviewed actions show the classifier's false-allow or false-deny above an alternative pin's → that pin |
| agents.claude.denied_tools.frontier | Agent(model:fable) | measured: the only frontier alias in the Agent tool's model enum (CLI 2.1.282); Workflow agent() opts.model is guarded by instruction only; an alias shared with the top pin would collide | 2026-09-27 | a CLI release adds a frontier alias, or permission rules see Workflow agents → extend the deny |
| agents.pi.search_tier | small | preference: each search is one extra request on the pool | 2026-09-23 | a measured miss the top tier's search catches → top |
| agent_mcp_servers.pi.reasoning_effort | high | preference: review and advice are recall-critical | 2026-09-23 | a usage reading with only trivial cross-model findings → medium |
| subagents.effort.high | spec-reviewer, general-purpose, Plan | preference: recall-critical or driver-like work | 2026-09-25 | manual reading: zero-finding spec-reviewer runs above half of its dispatches → medium for that role |
| subagents.Explore.effort | low | preference: routine lookups on the small tier | 2026-09-25 | a measured miss → medium |
| subagents.effort.lens | medium on lens reviewers | benchmark: CodeRabbit catches level with high | 2026-09-25 | a lens review misses a catch → high for that role |
| subagents.researchers.no_bash | researcher, dep-researcher: no Bash | forced: agent_sandbox.network is a fixed allowlist without upstream release-note hosts; WebFetch/WebSearch reach them, curl fails confusingly | 2026-08-20 | the sandbox allowlist covers upstream hosts, or a fetch tool fails on them → Bash |
| subagents.dep_researcher.tier | top | measured: both observed escalations (2026-09-23) were tier escalations | 2026-09-23 | a usage reading with no tier escalation over 14 days → small |
| subagents.implementer.tier | top | preference: small-tier executors regress on judgment; a failed attempt round-trips through the parent context | 2026-08-28 | a small-tier probe on settled-design slices matches top's repair rate → small |
| subagents.infra_reviewer | separate from diff-reviewer | preference: chart/CRD/GitOps hazards are not inferable from surrounding manifests | 2026-09-25 | a manifest review where diff-reviewer's lens finds the same hazards → fold in |
| parity.claude_readonly_bash | Claude read-only roles can write in cwd via Bash | forced: no per-subagent sandbox; tools list enforces | 2026-09-15 | Claude ships a per-subagent sandbox |
| parity.commit_push | Claude prefix deny; pi classifier + confirm | forced: each harness's gate; deny by default | 2026-09-21 | an unprompted commit or push on either |
| parity.post_plan_mode | Claude post-plan mode: CLI default | preference: auto during plan mirrors pi's classifier | 2026-09-26 | an unreviewed post-plan write |
| parity.cross_model | review/advice Claude→pi only | preference: reverse would spend the Anthropic pool | 2026-09-15 | Anthropic pool stops binding while pi's binds |
| parity.harness_intrinsic | Claude: Workflow, memory, Plan agent; pi: broker | forced: harness-intrinsic | 2026-09-26 | a harness ships the other's feature |
| parity.mcp_sandbox | Claude MCP servers run unsandboxed; pi in SRT except Playwright | forced: Claude's sandbox covers Bash only | 2026-09-22 | Claude sandboxes MCP servers |
| parity.pi_sandbox_paths | pi alone: /var/tmp writable; agent dir and ~/.zshrc write-denied | forced: bash 3.2 heredocs need a writable /var/tmp, /tmp or cwd and pi read-only roles have none; Claude protects its home natively | 2026-09-11 | pi read-only roles gain a writable cwd, or /bin/bash ≥ 4 |
| parity.web_tools | pi: no built-in fetch, Exa is WebFetch's counterpart; Claude Bash alone reaches *.anthropic.com and code.claude.com | forced: pi-web-search ships search only on the OpenAI route; the domains serve Claude's own docs and API | 2026-09-23 | pi's search plugin ships fetch → drop the Exa mapping |
| plugins.frontend_design | Claude plugin, not ported | preference: UI work happens in Claude | 2026-09-28 | a pi UI task → shared skill stub |
| setting.local_only_surface | Claude: claude.ai surfaces, cron and remote tools off, denied_tools, skill_overrides, no LSP or security plugins; pi: enableInstallTelemetry false | preference: local-only | 2026-09-21 | a surface is wanted → reverse per entry; a pi release changes the telemetry key |
| setting.subagentPromptCacheTtl | unset | vendor: 1h writes 2× vs 1.25× | 2026-09-27 | manual reading: expiry rewrites above 39% of subagent cache writes |
| setting.maxEffortLevel | unset | measured: 0 Fable forks in 30 days; caps `/effort xhigh` | 2026-09-27 | a Fable workflow or fork outside a probe → cap Fable at high |
| setting.autoCompactWindow | unset | measured: 0 compactions in 30 days | 2026-09-26 | manual reading: p90 root context above 300K |
| setting.workflowSizeGuideline | small, trial | measured: 2026-09-26 week 11 runs = 67% of Claude usage; last unguided runs 11, 3 and 8 agents (2026-09-27); the "size the fan-out to the ask" instruction cut landed with it, judged together | 2026-09-28 | after 14 days the workflow share of Claude usage (agent-usage) is not below 67%, or agents per run not below those readings → unset |
| setting.explore_routing | routing descriptions, trial | measured: Explore:explore-deep 37:99 Claude, 25:120 pi, 45 days | 2026-09-28 | after 14 days agent-usage's Explore:explore-deep dispatch ratio is not above the before readings, or a measured Explore miss → revert the descriptions |
| setting.hideThinkingBlock | false (pi) | forced: the workflow blanks reasoning itself; its spacer needs the native hide off | 2026-09-08 | the workflow spacer stops depending on the native block → unset |
| setting.pi_contextWindow | no modelOverrides raise | measured: 272,000 input tokens on the subscription route; a raise only defers compaction until the provider rejects | 2026-09-26 | the live readout reports a different input limit |
| setting.pi_defaultThinkingLevel | settings own the root level, no per-mode set | preference: a /thinking choice survives mode switches | 2026-09-26 | a measured need for a plan/execute effort split |
| measure.omitClaudeMd | Explore, Plan | measured: child first turn 16.2k; post-apply reading pending | 2026-09-23 | distilled-findings regression → revert |
| measure.researcher_cost | researcher on top | measured: Opus 18 calls at 123k vs Sonnet 7 | 2026-09-26 | per-dispatch cost above implementer's |
| measure.cross_model_review | risk-or-breadth | measured: ≈30 real findings in 20 reviews | 2026-09-23 | under 1 hit in 10 reviews → narrow the trigger |
| measure.gpt_over_testing | no test-restraint | measured: GPT arms 2.8-3.5× shipped tests | 2026-09-23 | repeat replay above 2× → vendor's no-tests-for-reversible-changes line |
| measure.single_writer | implementer only | measured: implementer median 17 calls per dispatch (2026-09-26) | 2026-09-21 | median calls per dispatch above 34 in a usage reading → second write-capable specialist |
| measure.classifier_cost | both stages on top | vendor: Claude auto mode, one model; unmeasured | 2026-09-26 | manual reading of pi sessions: classifier calls above 15% of pi root spend → filter to small |
| pin.pi_plugins | pi-subagents 0.70.1, pi-mcp-adapter 2.36.0 | vendor: 0.72 and 3.0 add nothing that retires owned code | 2026-09-28 | a release ships a renderer hook, fleet run ids or a log-level setting → bump as its own change |
| pi.second_vendor | none for children | measured: children 25% of pi spend | 2026-09-18 | pool binds 2 of 4 weeks, children ≥30% → OpenCode Go for explore-deep |
