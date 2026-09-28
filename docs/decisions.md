# Harness decisions

Sole owner of each live harness decision's why, evidence and reversal
trigger; a superseded row is deleted (git keeps history). `npm run test:pi`
checks the table against the current pins, drivers and classifier.

## Adopting or moving a model

1. Confirm it is live: `claude --model <id> -p 'reply OK' --output-format json`, or listed in `node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`; else land the SDK bump first, alone.
2. Edit only `subagent_tiers` (or `agents.<h>.defaults.tier`) in agents.yaml, one slot per change; a model without a counterpart in the other lineup moves only its harness's pin.
3. Run `npm run test:pi` and `chezmoi diff`; an unsupported effort fails.
4. After the owner applies, re-run (1) for the new pin.
5. Update its row: before reading (`scripts/agent-usage.mjs`), evidence kind, revert threshold. Dwell 14 days.

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
| subagent_tiers.claude.top | claude-opus-5-5 | benchmark: AA $/task 2026-09-25; no paired replay | 2026-09-25 | pool binds 2 of 4 weeks → matched comparison vs next cheaper pin; unattended text-only turn ends → claude-opus-5 |
| subagent_tiers.claude.frontier | claude-fable-5-1 | preference: escalation-only | 2026-09-25 | 50% weekly cap lifted, or a matched-effort eval puts it ahead → re-open driver |
| subagent_tiers.pi.small | gpt-6-luna | benchmark: matches Luna 5.6 at 0.4× cost per task | 2026-09-23 | leaves the pinned catalog → report unavailable, re-pin |
| subagent_tiers.pi.top | gpt-6-sol | benchmark: beats Terra 5.6, fewer tokens | 2026-09-23 | leaves the catalog → re-pin |
| subagent_tiers.pi.frontier | gpt-6-astra | vendor: OpenAI rates Astra-low above Sol-high | 2026-09-23 | leaves the catalog → re-pin; pi pool binds 2 of 4 weeks → matched comparison vs Sol |
| agents.claude.defaults.tier | top, effort high | preference: pool-headroom rule | 2026-09-25 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.tier | frontier, effort high | benchmark: AA Terminal-Bench, high cheaper per task | 2026-09-26 | pool at limit 2 of 4 weeks → lower effort, then matched comparison |
| agents.pi.defaults.classifier | tier top, filter off, judge medium | vendor: GPT-6 system card injection defence; replay gate never run | 2026-09-26 | re-extracted reviewed actions show the classifier's false-allow or false-deny above an alternative pin's → that pin |
| subagents.effort.high | spec-reviewer, general-purpose, Plan | preference: recall-critical or driver-like work | 2026-09-25 | zero-finding spec-reviewer runs above half of a usage reading → medium for that role |
| subagents.Explore.effort | low | preference: routine lookups on the small tier | 2026-09-25 | a measured miss → medium |
| subagents.effort.lens | medium on lens reviewers | benchmark: CodeRabbit catches level with high | 2026-09-25 | a lens review misses a catch → high for that role |
| subagents.researchers.no_bash | researcher, dep-researcher: no Bash | forced: agent_sandbox.network allowlists 16 hosts, upstream release notes not among them; WebFetch/WebSearch reach them, curl fails confusingly | 2026-08-20 | the sandbox allowlist covers upstream hosts, or a fetch tool fails on them → Bash |
| subagents.dep_researcher.tier | top | measured: both observed escalations (2026-09-23) were tier escalations | 2026-09-23 | a usage reading with no tier escalation over 14 days → small |
| subagents.implementer.tier | top | preference: small-tier executors regress on judgment; a failed attempt round-trips through the parent context | 2026-08-28 | a small-tier probe on settled-design slices matches top's repair rate → small |
| subagents.infra_reviewer | separate from diff-reviewer | preference: chart/CRD/GitOps hazards are not inferable from surrounding manifests | 2026-09-25 | a manifest review where diff-reviewer's lens finds the same hazards → fold in |
| parity.driver_tier | Claude top, pi frontier | preference: pool-headroom rule | 2026-09-25 | a defaults.tier row fires |
| parity.pi_skill_listing | pi skills user-invocable only (`/skill:`) | forced: workspace_* rename side effect | 2026-09-26 | a pi release lists skills while only workspace_* tools are active → restore the listing |
| parity.pi_mcp_grant | pi MCP grant per role all-or-nothing | forced: no per-tool grant | 2026-09-22 | pi-mcp-adapter or pi-subagents ships a per-tool MCP grant → grant per tool |
| parity.claude_readonly_bash | Claude read-only roles can write in cwd via Bash | forced: no per-subagent sandbox; tools list enforces | 2026-09-15 | Claude ships a per-subagent sandbox |
| parity.commit_push | Claude prefix deny; pi classifier + confirm | forced: each harness's gate; deny by default | 2026-09-21 | an unprompted commit or push on either |
| parity.post_plan_mode | Claude post-plan mode: CLI default | preference: auto during plan mirrors pi's classifier | 2026-09-26 | an unreviewed post-plan write |
| parity.cross_model | review/advice Claude→pi only | preference: reverse would spend the Anthropic pool | 2026-09-15 | Anthropic pool stops binding while pi's binds |
| parity.harness_intrinsic | Claude: Workflow, memory, Plan, plugins; pi: broker, classifier, usage segments | forced: harness-intrinsic | 2026-09-26 | a harness ships the other's feature |
| setting.subagentPromptCacheTtl | unset | vendor: 1h writes 2× vs 1.25× | 2026-09-27 | expiry rewrites above 39% of subagent cache writes |
| setting.maxEffortLevel | unset | measured: 0 Fable forks in 30 days; caps `/effort xhigh` | 2026-09-27 | a Fable workflow or fork outside a probe → cap Fable at high |
| setting.autoCompactWindow | unset | measured: 0 compactions in 30 days | 2026-09-26 | p90 root context above 300K |
| setting.workflowSizeGuideline | small, trial | measured: 2026-09-26 week 11 runs = 67% of Claude usage; last unguided runs 11, 3 and 8 agents (2026-09-27) | 2026-09-28 | after 14 days the workflow share of Claude usage (agent-usage) is not below 67%, or agents per run not below those readings → unset |
| setting.explore_routing | routing descriptions, trial | measured: Explore:explore-deep 37:99 Claude, 25:120 pi, 45 days | 2026-09-28 | re-dispatch to explore-deep above 25% of sessions, or Explore root re-reads above explore-deep's |
| setting.enableInstallTelemetry | false (pi) | preference: local-only | 2026-09-28 | a pi release changes the key |
| setting.hideThinkingBlock | false (pi) | forced: the workflow blanks reasoning itself; its spacer needs the native hide off | 2026-09-08 | the workflow spacer stops depending on the native block → unset |
| measure.omitClaudeMd | Explore, Plan | measured: child first turn 16.2k; post-apply reading pending | 2026-09-23 | distilled-findings regression → revert |
| measure.researcher_cost | researcher on top | measured: Opus 18 calls at 123k vs Sonnet 7 | 2026-09-26 | per-dispatch cost above implementer's |
| measure.cross_model_review | risk-or-breadth | measured: ≈30 real findings in 20 reviews | 2026-09-23 | under 1 hit in 10 reviews → narrow the trigger |
| measure.gpt_over_testing | no test-restraint | measured: GPT arms 2.8-3.5× shipped tests | 2026-09-23 | repeat replay above 2× → vendor's no-tests-for-reversible-changes line |
| measure.single_writer | implementer only | measured: implementer median 17 calls per dispatch (2026-09-26) | 2026-09-21 | median calls per dispatch above 34 in a usage reading → second write-capable specialist |
| measure.classifier_cost | both stages on top | vendor: Claude auto mode, one model; unmeasured | 2026-09-26 | classifier calls, once scripts/agent-usage.mjs keys them apart from root calls, above 15% of pi root spend → filter to small |
| pin.pi_plugins | pi-subagents 0.70.1, pi-mcp-adapter 2.36.0 | vendor: 0.72 and 3.0 add nothing that retires owned code | 2026-09-28 | a release ships a renderer hook, fleet run ids or a log-level setting → bump as its own change |
| pi.second_vendor | none for children | measured: children 25% of pi spend | 2026-09-18 | pool binds 2 weeks running, children ≥30% → OpenCode Go for explore-deep |
| pi.residual.approval_timeout | a timed-out approval leaves its review queued | preference: residual accepted 2026-09-15, none observed | 2026-09-15 | approval timeouts seen, or a late verdict applied |
| pi.residual.ticket_binding | ticket bound to epoch/role/tool, not arguments | preference: residual accepted 2026-09-15, none observed | 2026-09-15 | approval flow changes, or pi lets arguments change post-review |
| pi.residual.setsid_escape | setsid/double-fork/other-user children escape kill | preference: residual accepted 2026-09-15, none observed | 2026-09-15 | an orphan after a kill, or a role granted a daemoniser |
| pi.residual.followups | paste cancels completions; folds grow; forkContext full copy; fleet rows in footer; `wham/usage` read | preference: fix on trigger | 2026-09-15 | paste bug hit; TUI lag; pi-subagents makes summary errors non-fatal; configurable dock order; `wham/usage` breaks → `@hk_net/pi-usage-bars` |
