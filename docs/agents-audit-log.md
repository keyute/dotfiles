# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`AGENTS.md` → Placement). An entry whose trigger has resolved and whose
baseline no longer serves a future sweep is deleted, not archived — git
history keeps it.

## 2026-09-18

### (pi) Delegation sweep and completion-guard false failures

Store copied by the user to a sandbox-readable path; metadata only (tool
names and paths, usage, artifact `_meta.json`, three `_output.md` "Changed"
headings). Window 2026-09-16/17: 38 root sessions across nine projects, ~260
child runs. Pipelines: `jq` over `subagent-artifacts/*_meta.json` for agent,
model, `exitCode`, `usage`, `error`; a node pass over each root JSONL and its
`<session>/<child>/run-0/session.jsonl` for cost and for root `workspace_read`
paths that a child also read, split by whether the root read fell inside the
child's run window (duplication) or after it (post-report re-read).

- Pins held: every child on Terra, Sol or Luna, zero Astra. One nested launch
  in ~260 runs (general-purpose → spec-reviewer); that child polled `status`
  nine times for its one launch. Spend: root ≈ $254 of ≈ $338, children ≈ $84
  (pi's own cost estimate, not quota). Root cost is mostly cache reads of a
  long context.
- Per agent (runs / child $ / post-report root re-reads of child-read paths):
  explore-deep 79 / 22.6 / 450 of 1,583 (~28%); implementer 36 / 11.8 / 50;
  spec-reviewer 28 / 13.1 / ~2; general-purpose 5 / 16.2 / 11 (two runs ≈ $7
  each, 64 and 50 turns, 10 and 20 own edits); explorer 15 / 0.12; dep-researcher
  29 / 0.58. Luna roles pay off unconditionally; explore-deep pays on average
  (~$0.29 a run against ~5× Astra input plus the permanent cache-read tail)
  except where the root re-reads the files anyway.
- During-run duplication (`delegation_wait`): ~35 root reads of child-read
  paths across all runs — closes the 2026-09-12 open item; the suffix
  relocation is not needed. Post-report re-reads concentrate in the three
  largest sessions (152, 131, 90), which also hold most inline root edits
  (27, 15, 12): the re-reads serve the root's own editing.
- Completion guard: three implementer runs and one explore-deep run ended
  `exitCode 1` with pi-subagents' "completed without making edits" error. Two
  implementers had written or edited still-untracked files with
  `workspace_write`/`workspace_edit` (invisible to both guard signals); one
  genuinely changed nothing; the explore-deep task merely read as
  implementation. The session holding a false failure is the only one where
  the root read raw `async-subagent-runs/*/output-0.log` and `status.json`
  (11 reads). Fix: `mutationTools` / `completionGuard: false` via `pi-roles`
  (`docs/pi-implementation.md` 2026-09-18).
- **Open**: after the guard fix, re-measure post-report re-reads of explorer
  paths and general-purpose used for implementation-shaped work; both are
  named by existing rules (delegation economics, frontier driver) and get a
  baseline change only if they persist — which needs the claude and codex
  sweeps the audit skill owns, not this pi-only sample. Nested-child polling
  stays a one-off watch item.

## 2026-09-16

### (pi) Audit baseline and containment decision

- 10 authorized exported root sessions: every actual assistant was Astra at high
  reasoning. Their 65 direct and one nested children were 51 Terra, 10 Sol, and
  5 Luna, zero Astra; all 65 direct children matched configured tiers, including
  12 implementers. No direct root file edits preceded recorded approval. Shell
  and mode-effect evidence is incomplete.
- Of 24 returned shell task IDs with terminal records, 16 completed, 5 failed,
  and 3 stopped. Root tokens were 2,518,410 input / 194,388 output / 29,391,744
  cache-read; child tokens were 4,283,937 / 375,658 / 35,114,752. Token metadata
  is neither subscription quota nor dollar cost.
- Upstream subagent JSON schema fell from 16,225 bytes and 79 properties to
  3,470 bytes and 16. No dollar or latency savings are inferred. Transcript
  accusations of root/worker concurrent writes and duplicate reviews are not
  substantiated: root writes followed worker completion, and similar reviews
  covered different repos. Managed child leases already abort; the detached
  runner cleanup uses session-owned RPC stops and observed process-terminal
  evidence. Review caught completion/exit confusion, historical overflow,
  natural-exit races, and shutdown wake-ups; regression tests cover the fixes.
  No permanent transcript copies are retained.
- Verification: 294 normal tests passed on the host, including socket integration;
  docs checks and changed-target renders passed. **Open:** the unchanged optional
  live-SRT test expects `/denied/` where policy now returns `Writes are disabled
  in this scope`. A disposable smoke check separately passed plan-write denial,
  approved execution, sensitive-symlink denial, reviewed host execution, and
  lease cleanup; the stale test was not weakened or changed.

### (pi) Browser launch — managed host exception

- Playwright MCP 0.0.80's full Chromium 1243 (153.0.8010.12) and SRT 0.0.75
  cannot launch under current containment. The live initial `ProcessSingleton`
  failure is sandbox-caused, not a stale profile. A scratch `MAC_CHROMIUM_TMPDIR`
  fixed-directory probe passed that failure but then hit denied Unix-socket bind;
  a fixture-only `allowUnixSockets: [ownscratch]` passed it and then fatally
  failed on `base/mac/mac_util.mm:379`, `sysctlbyname kern.hv_vmm_present`
  denied. The pinned SRT fixed sysctl allowlist lacks that key and has no
  supported configuration override. Crashpad Mach and settings warnings were
  also observed but are not claimed as the root fatal:
  [Chromium check](https://github.com/chromium/chromium/blob/153.0.8010.12/base/mac/mac_util.mm#L376-L380),
  [Apple file utility](https://github.com/chromium/chromium/blob/main/base/files/file_util_apple.mm).
- Later owner decision (2026-09-16): frontend browser verification is required;
  retain shared Playwright and grant only its broker-selected server a host
  lease. PATH/HOME/scratch TMPDIR only; tool approval/denials and lifecycle
  remain, but browser/server filesystem and network access are not SRT-contained.
- Source-stage live gate passed: local navigation, click/DOM assertion, PNG
  screenshot, browser close/reopen, mode-switch termination of all 16 observed
  processes, and scratch removal. Unsafe-tool and plan-mode interaction checks
  rejected as expected. No applied configuration changed.

## 2026-09-15

### Delegation sample and Claude routing correction

The frontier-driver decision from `49b4cff` stands; this change makes its
implementation handoff trigger concrete without changing worker pins or guards.

- Five Sep 15 Claude sessions contained 26 child logs. Deduplicated direct
  source Edit/Write calls (excluding 16 plan/memory writes; shell mutations not
  counted) were 86 root / 61 child. Session prefixes (root/child): `ac795c23`
  2/0, `fe817516` 0/0, `85d28926` 18/0, `1f35ace2` 5/0, `7c60182f` 61/61.
  The pre-change Sep 11/12 `implementer = 0` remains the comparison baseline;
  this sample had four implementation
  dispatches, all in the i18n session. The root made 46 source writes before
  the first, and those four handoffs totalled 14,230 prompt characters. After
  receiving a glossary it still wrote five catalogs totalling 85,195
  characters. Shared `en.json` made serial extraction and some root integration
  reasonable; the sample proves neither delegate-everything nor worker quality.
- All 21 child logs from stable 2.1.236 served Opus 5 despite Haiku/Sonnet
  configuration. After switching to latest 2.1.272, the exported sample served
  Explore and `claude-code-guide` on Haiku 4.5 and three researcher children on
  Sonnet 5. This matches the 2.1.251 change that made
  `CLAUDE_CODE_SUBAGENT_MODEL` a fallback: per-call → definition → env → parent
  ([release](https://github.com/anthropics/claude-code/releases/tag/v2.1.251),
  [sub-agents docs](https://code.claude.com/docs/en/sub-agents)). The source
  Fable 5 `[1m]` pin did not change; a latest-channel Fable 5.1 session shows
  availability, not changed source configuration. There is no post-2.1.272
  implementation sample, so routing and delegation efficacy remain open.
- The instruction change keeps read-only exploration, research, and bounded
  option proposals available during planning, while reserving architecture,
  approval, and synthesis for the driver. Its source-edit trigger applies only
  after an implementation slice has settled design, exclusive ownership, and
  an objective gate; the worker then owns its test/repair loop. Relevant
  model-qualified guidance: [Astra](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra),
  [Sol](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6-sol),
  [Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5),
  [Fable 5.1](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1),
  and [Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5)
  address delegation triggers, bounded autonomy, async work, and excessive
  verification; they do not all prescribe one orchestration recipe.
  The [Cursor](https://cursor.com/blog/scaling-agents) report and
  [Aider](https://aider.chat/2024/09/26/architect.html) experiment support
  planner/worker separation, not a current tier-cost or Max-savings claim.
  Claude is measured above; Codex/pi remain configuration- and guidance-based.
- Raw transcript tokens are not Max quota costs. Exact model and cache-read
  weighting, quota savings from delegation, and a primary cost lever remain
  unverified. Two Reddit searches also yielded no fetchable source; no snippets
  or community consensus were used.

### Review of 49b4cff — doctrine, tiers, docs (same day)

Full audit (skill steps 1–4 and 6; step 5 skipped, the doctrine was hours
old), a doctrine-refresh pass and a bloat sweep. That review retained every pin,
including Fable 5 for stable-channel compatibility. Current latest-channel
availability and routing are recorded above; the pin remains unchanged.
Measurements below were moved from the baseline whys into this audit record:

- Frontier-driver evidence. Anthropic's Fable 5 guide, verbatim: "dispatches
  parallel subagents more readily than prior models. Use subagents
  frequently… prefer asynchronous communication between orchestrator and
  subagents"; "Separate, fresh-context verifier subagents tend to outperform
  self-critique". Opus 5 separately cautions against redundant verification and
  small-task delegation. The prior Claude probe reported a "don't call the
  Agent tool unless asked" line under an Opus 5 driver. OpenAI's GPT-6 Astra guide: "may delegate less often than desired
  for your workflow. Specify when and how much it should use subagents" — the
  vendor-documented failure that keeps the rule projected on Codex/pi.
  Dropped as unsourced: "an Astra rebase at 6h+ vs Sol's 1h"; dropped as
  irrelevant: "OpenAI gates its coordination mode to the top tier" (ultra
  runs on Sol, the top worker tier). Field reports: lilting.ch 2026-09-07 —
  Astra as orchestrator "promoted every task to itself" despite AGENTS.md and
  burned a weekly quota in half a day (the Codex-side risk baseline; no
  blocking lever exists); eigenwise.io 2026-09-07 — Astra orchestrator,
  GPT-5.6 executors, Opus reviewer at ~1:5 requests; Ronacher 2026-09-07 —
  subagents underperform outside investigation; martinfowler.com
  "orchestrator tax" 2026-07-16 — the sink was the orchestrator reading
  verbose child output. Metering: Fable ≤50% of the weekly pool on Max
  (support article 2026-09-02); claude-code#91220 — one resumed 16.7h
  subagent = 50.7% of a Max 20x weekly pool, 227.8M cache-read vs 72K output
  tokens. Quota failures with a child on the frontier tier: claude-code#84667
  (16 unpinned children, 2,448 messages/18 min), #75055 (84 children, 11.6M
  tokens), #75054 (pins lost on background resume), #85592 (env var overrode
  per-call requests at 2.1.223), #82252 (override served by another model),
  #91160 (env var as hard override at 2.1.236, the documented pre-2.1.251
  behavior); codex#32587 remains open.
- Self-review evidence: models fix an identical bug when told it is someone
  else's but not their own (64.5% blind spot, arXiv 2507.02778); self-review
  endorses ~32% of its own behaviour-changing output (2605.21537); a
  fresh-context pass beats same-session self-review (F1 28.6% vs 24.6%,
  2603.12123) while reviewing twice in one session does not; iterated rounds
  add false positives faster than catches (+62%, precision 0.30→0.20,
  2603.16244). Reviewer tier: 2607.21656's 91.4%→82.8% drop was a
  cross-vendor reviewer rewriting the program, not advisory findings; the
  freshness studies never vary tier; CodeRabbit 2026-07-24: Opus 5 x-high
  55.2% vs mix 61.1% known-issue recall, weakest on concurrency. 2026-09-09
  sweep: 20 dispatches — 10 to a write-capable catch-all, 8 to a diff-lens
  reviewer, 6 to whatever tier the dispatcher picked. 2026-09-12 sweep: fired
  13 times in 13 sessions in two days, trivial bodies included; 4–5
  zero-finding runs at ~51k top-tier tokens; one body re-reviewed 35 min
  later; suites re-run green; 1 high + 3 medium catches, all on high-stakes
  surfaces (the Opus-tier baseline to beat). Precedence clause: the Claude
  harness passage discouraging extra review passes was present 2026-09-09,
  absent from the Fable 5.1 main loop on 2026-09-15 (lapsed 2026-09-12);
  Codex Sol and Astra carry none.
- Cross-model review evidence: a size-only trigger fired ~20x more often
  while its hit rate fell from ~4% to under 1%; Codex review displaced the
  subagent pass in 68% of sessions that fired it (101 of 149, 2026-09-09,
  pre-`spec-reviewer` baseline). Survived-findings count still unmeasured.
- Initiative evidence: OpenAI's GPT-6 Astra guide documents stopping to ask
  where the user expects persistence; Anthropic documents the same for Fable
  5.1; the GPT-5.6 guide finds repeated approval wording causes approval
  requests for expected actions. Verified 2026-09-08/09 against the
  model-qualified guide URLs (the bare `latest-model` alias is mutable).
- Coverage matrix (probes 2026-09-15). Claude: the Fable 5.1 main loop
  carries initiative, partial_delivery, faithful_reporting and
  long_running_work verbatim, delegation_wait for searches, docs_mcp via the
  context7 server instructions, convention_recording via the memory system;
  Opus 5 child: delegation_wait, call_batching, credential_hygiene covered;
  Sonnet 5 child: call_batching, long_running_work, commit_etiquette covered;
  Haiku 4.5 child: call_batching partial only (re-probe before un-shaving).
  Pinned driver (`claude --model claude-fable-5[1m] -p`, same day):
  initiative and faithful_reporting covered, long_running_work and
  convention_recording partial, docs_mcp absent in print mode (no MCP server
  instructions load there; interactive sessions carry them). Shaved on
  Claude: initiative (covered on both driver classes, moot for children —
  repeating it is the documented harm) and docs_mcp (carried by the context7
  server instructions wherever those tools exist; the researcher bodies name
  context7 themselves). Kept after the pin probe: long_running_work and
  convention_recording. Codex (Sol
  default, Astra override): initiative covered on both; call_batching Astra
  covered, Sol partial; HARNESS-CONFLICT on both classes, verbatim — "Do not
  spawn sub-agents unless the user or applicable AGENTS.md/skill instructions
  explicitly ask for sub-agents, delegation, or parallel agent work." and
  "Only set `model` or `reasoning_effort` when explicitly requested by the
  user, applicable `AGENTS.md` instructions, or skill instructions" /
  "inherited parent model is preferred" — resolved by making the projected
  delegation and child-model lines explicit instructions, the "applicable
  AGENTS.md instruction" the prompt defers to (vendor: "explicit spawn values
  override `agents.default_subagent_model`"). Sol misreports itself as
  "GPT-5"; Terra and Luna pins answered. pi (static): only delegation_wait
  and tier_selection appear, in the repo's own tool description; nothing
  shaved. Whether Codex or pi children load AGENTS.md is unstated in prompt
  and docs; Claude's do (sub-agents doc: every level of the CLAUDE.md
  hierarchy, Explore/Plan excepted), which is why the projection now groups
  the driver-only rules under one bullet.
- Documented-reliance check: CLAUDE_CODE_SUBAGENT_MODEL, the four-step
  resolution order, hooks running inside subagents and the PreToolUse deny
  shape are vendor-documented; `_FORCE` stays unset to preserve specialist pins.
- Doctrine-refresh: the density why is supported in direction (Anthropic
  memory doc: target under 200 lines, longer reduces adherence; OpenAI
  harness-engineering 2026-02-11: ~100-line AGENTS.md as a table of
  contents; arXiv 2602.11988: context files +20% cost, no general gain;
  2608.12426: joint compliance collapses past 5–6 simultaneous constraints);
  the why-style is stated by the Fable 5 guide ("Give the reason, not only
  the request"); emphasis-scarcity is compatible with Anthropic's
  best-practices advice; discretionary-loading under-triggering rests on
  vendor design rationale only.
- Merges, so the next audit does not re-add them: tier_selection →
  frontier_driver; fan_out → delegation_contract; community_search →
  web_search. Shave by mechanism: the sensitive-path enumeration left the
  projection (sandbox-enforced on every harness). Bloat baseline before the
  cut: pi-implementation 930 lines (88% dated changelog), pi-design 423,
  baseline 321 (158 why-lines, ~half measurement/history), Claude harness doc
  168 (~47 lines duplicating baseline whys); `npm run test:docs` now holds
  the budgets.
- Codex cross-check (Sol, two calls): agreed with every proposal except a
  separate Exa-fetch clause (folded into web_search); noted Astra's
  under-delegation justifies the delegation line, not the driver choice.
  Codex review of the applied change (one round, five findings): "a child
  never inherits" read as a guarantee — reworded as an instruction with the
  pin-is-a-default caveat; shaves probed only on the 5.1 main loop — the
  pinned Fable 5 probe above narrowed them to two; the lint accepted invalid
  or future dates, flipped fences on any backtick line, and scanned only the
  top-level template for `onepasswordRead` — all three fixed with a test for
  the date case. Survived findings: 4 of 5 fixed, 1 narrowed.
- **Open** (next sweep): children's actual `message.model` vs pins after
  each CLI update, including the third-party `inherit` residual; implementation
  dispatches after 2.1.272 and the new trigger (handoff timing, successful gates,
  repairs, elapsed time, and driver/worker usage); spec-reviewer high/medium
  catches at Opus vs the 1 high + 3 medium of 13 baseline; Fable share via `/usage`;
  cache-read weighting in Max metering; Haiku call_batching re-probe; Codex
  child model via `/status` after each CLI update; Codex subagent facts
  unverified since 2026-07-31 (harness doc); survived codex-review findings;
  driver effort as a lever (API pricing claim, unmeasured on Max).

### (pi) Relocated from the pruned build log

`docs/pi-implementation.md` went from 930 to under 120 lines on 2026-09-15;
the two measurements still carrying a trigger moved here.

- Cost read (session `01a0848e`, 2026-09-09 05:05–05:28Z, from its own
  `usage.cost` records): 192.9k uncached input, 2.26M cache reads, 10.5k
  output, $4.71 (≈118 credits) over 23 minutes, 40 assistant turns, 10
  children, peak root context 99.9k. Every turn ran `gpt-6-astra`; the same
  trajectory on `gpt-5.6-sol` is ~$1.88, so the tier choice moves cost 2.5×
  before any harness difference does. Pi and Codex share the provider and
  endpoint, so a harness differs only in tokens per finished task: controlled
  run 4 was 0.87× Codex at time parity, run 5 3.9× at more than twice the
  wall clock, on identical source — the variable is child count (3 vs 8), not
  the harness. No context bloat: 13k → 99k with one 35k step where eight
  child reports landed at once. **Open**: the Astra-default baseline to
  measure against; compare Sol and Astra on matched completed tasks.
- Approval classifier (2026-09-09): two stage-shaped failures — a 17 s
  median with p90 at the timeout, and two read-only denials, one a retry of a
  command that had just failed sandboxed (`gh` HTTPS fails under the seatbelt:
  Go's TLS verifier needs the `com.apple.trustd.agent` mach service, allowed
  only under `enableWeakerNetworkIsolation`; the profile stands). Design taken
  from Anthropic's two-stage auto-mode classifier (single-token filter, then
  reasoning on a flag over the same cached prompt; false positives 8.5% →
  0.4% reported) and Codex's deterministic gates: `classifier_filter` (Luna,
  minimal) answers every reviewed action, `classifier_judge` (Terra, medium)
  re-judges any non-allow; the message is `{ task, history, action }` with
  the last 20 shell commands (output-blind, 16 KiB budget). **Open**: the next
  same-prompt run records per-stage latency, how many actions reached the
  judge, and the judge's verdict on escalations after a failed sandboxed
  attempt; if the filter still forwards read-only escalations more than
  occasionally, raise its effort to low before touching the prompt. Not done:
  denials carry no rationale, no fallback to prompting after repeated blocks,
  new network hosts are never reviewed, no per-rule allow/ask list.
- pi harness `## Web search` is still annotated "unapplied" (2026-09-08);
  **Open**: confirm applied state at the next apply.

## 2026-09-14

### Frontier doctrine decision (all harnesses) — superseded 2026-09-15

Consultant doctrine, reversed the next day; its research record was deleted
2026-09-15 (git history keeps it) and its still-live items — the metering
figures and the cache-read-weighting trigger — moved into the 2026-09-15
review entry above.

## 2026-09-12

### (claude) Coverage probes

- The self-review re-probe fired: neither Fable 5 nor Opus 5's harness prompt
  still carries the "stop adding review passes once checks pass" line, so the
  precedence clause's Claude harness-conflict has lapsed in both probed
  classes. Clause retained — it still guards the deterministic-gate
  distinction.
- Codex Sol's prompt now reads "Do not spawn sub-agents unless the user or
  applicable AGENTS.md/skill instructions explicitly ask"; the projected
  delegation and self-review lines satisfy its carve-out. Recorded as a
  resolved harness-conflict, no wording change; Codex concurred.

### (claude) Model-quirk projections

Still-governing rationale (2026-09-07 sweep): Fable's quirks (whole-file
rewrites, fewer progress updates, under-batched tool calls) are projected in
CLAUDE.md or carried by the harness prompt; Opus 5's candidate quirks
(over-delegation, over-verification) showed no signal — Opus 5 and Fable
sessions delegated at the same rate (3.8% vs 3.5% of tool calls) under the
model-neutral rule — and stay unprojected.

### (claude) Self-review vs codex-review

Prior state: both rules fired on the same high-stakes set from 2026-08-27 and
the W35–W37 sweeps showed codex-review displacing the fresh-eyes pass, with
41% of editing sessions (30d, 341 sessions with ≥3 writes, 2026-09-09) running
no review of any kind and the fresh-eyes rule firing in only ~20 dispatches
(~6%), 8 of them to diff/language reviewers whose contract cannot report an
omission — which is what `spec-reviewer` (added 2026-09-09, `tier: inherit`
as a capability floor) answers. Bar set then: spec-reviewer dispatches above
the 20/30d the unnamed pass managed; re-check the 41% no-review figure.

This audit's sweep (user-run pipeline; store held only 2026-09-11/12 — 19
sessions, no 30-day history): of 13 editing sessions, 12 ran codex-review AND
a reviewer dispatch, 1 ran neither — displacement absent in this window,
no-review rate 1/13. `spec-reviewer` fired 12 times in two days against the
20/30d bar. **Open**: both figures need a 30-day window to count as a
re-measure — repeat next audit.

### (claude) Fresh-eyes yield — first content-level count

13 spec-reviewer runs in 2 days, one per session; 669k subagent tokens
(~51k avg) at Fable rates ≈17% of subagent spend. Yield: 1 high + 3 medium +
18 low; 4–5 reviews returned zero findings; every high/medium sat on a
high-stakes surface (auth/OAuth/MCP, per-cluster deploy values). Waste modes:
firing on trivial test-gated bodies (a styling change drew a 32k zero-finding
review), one full re-review of the same body 35 min after the first,
reviewers re-running already-green suites. Decision: carve-outs sharpened in
the baseline (skip when gates cover the requirements and the surface is not
high-stakes; re-reviews verify the fixed findings only; reviewer body told
not to re-run green gates). **Open**: next sweep re-counts zero-finding share
and re-review scope under the new wording.

### (claude) Subagent roster friction / overrides

Agent model overrides 8/78 (10.3%; 30-day figure was 274/1790 = 15.3% on
2026-09-09): general-purpose 3/3, spec-reviewer 5/12 — the latter are
capability-floor escalations. `researcher` (added 2026-09-08 for the
hand-picked-sonnet research dispatches) uptake still unsplit. **Open**: next
sweep counts overrides per subagent_type, not just in total.

### (claude) Delegation economics — research + sweep corroboration

Research (delegate-everything question): subagent tokens draw the same Max
5h/weekly pools as the main loop — no subagent discount; `/usage` shows a
"subagent" share of the same pool (costs.md/errors.md). Drain is
model-weighted: Anthropic's only consumer ratio is "Opus reaches limits ~5x
faster than Sonnet" (support article, archived 2025-10-02), unreconciled with
the 2.5x API input-price ratio (Opus 5 $5/$25, Sonnet 5 $2/$10, Haiku $1/$5
per MTok). Cache reads are 0.1x in API billing (0.025x on Fable/Mythos 5.1)
but whether Max metering discounts them is documented nowhere. Delegation
multiplies total tokens (Anthropic's figures: multi-agent ≈15x chat, single
agent ≈4x, agent teams ≈7x; per-spawn CLAUDE.md/system-prompt resend
documented but unquantified) — it pays only via tier arbitrage and keeping a
grown top-tier context from re-metering (Max routing bug GH #43869 silently
billed "sonnet" children at parent Opus rates until ~v2.1.146). Anthropic's
cost-optimization guide: delegate when work exceeds one context window or
fans out across independent items; on their DeepWideSearch benchmark,
lowering reasoning effort beat an orchestrator+workers architecture (matched
accuracy, 20% cheaper). Delegate-everything refuted; the selective gate
stands.

Sweep baselines (2026-09-11/12, transcript content read with user
authorization): delegation 76/~2,000 tool calls (3.9%), read-heavy;
`implementer` 0 dispatches — all 374 Edits ran inline in Fable sessions. This
remains the pre-change comparison; the Sep 15 sample and next trigger are above.
Token shares over 2 days:
main-loop output 3.6M, cache-write 9.4M, cache-read 603M raw, all subagents
3.87M/77 runs — at the API's 0.025x Fable factor those reads are ~15M
input-equivalent, comparable to the output burn, not 100x it. **Open**:
whether Max metering discounts cache reads — and so whether session length or
output volume is the primary cost lever — check `/usage` next time a limit
binds.

### (claude) Codex-review survived findings

The bridge returns prose, not a JSON verdict, so labelled findings measure
nothing; the yield measure is findings the session actually fixed. Count
stands at 1 review / 0 survived (2026-09-09 ship-check: an
`active_long_running` mislabel the upstream source disproved). **Open**:
accumulate survived findings across reviews; decide the trigger's fate once
there are ten, against the ~2-in-10 test (roughly 2 of 10 findings surviving
justifies keeping the trigger).

### (codex) Pins held under delegation

14-day rollout sweep: 511 `spawn_agent` per ~10.5k `exec` (4.4% delegation),
children genuinely on Terra/Luna — 571 cheap-tier turn-contexts against 511
spawns, the excess consistent with multi-turn children. Baseline for the
openai/codex#32587 pin-inheritance watch (still open upstream, last activity
2026-07-12). Credit scaling is roughly linear with concurrent children at
equal model/effort (OpenAI engineer, openai/codex#13179).

### (codex) Subagent-section expiry

Expiry fired 2026-09-08, still open. The 2026-09-09 Claude-side audit
confirmed it cannot close it: the permission gate denied `~/.codex/sessions`
on two attempts, so the store stays unreadable from that side. **Open**:
re-verify pin behaviour from the next Codex session, and again after each
Codex CLI update.

### (pi) delegation_wait

Carried baseline (2026-09-09, 18 sessions / 137 launches): after its first
launch a parent still made a median of ~34 own calls (max 76) — an upper
bound, since the measure counts out-of-scope and post-synthesis work too.
This sweep (user-run pipeline, ~1 week, mostly pi self-development): 118
launches in ~1,450 tool calls (8.1%) plus 60 `list`/`status` calls (~0.5
polls per launch — polling overhead persists; the roster-in-tool-description
change has not removed `list` calls). Fleet mix review-heavy: 59
diff/language reviewers, 36 explorers, 12 researchers, 9 spec-reviewer, 2
general-purpose. `delegation_wait` stays projected (`native_coverage: []`).
Resolved 2026-09-18 on a narrower measure: root reads of a child's own files
while that child ran (~35 over ~260 runs), not the own-calls-after-launch
figure above, which was never re-measured and is not comparable. The suffix
relocation is not needed; the polling baseline above stays for comparison.

### (pi trial) Status

Not decidable through 2026-09-12: the Claude store sweep covered only a
2-day window, the Codex (14-day) and pi (~1-week) sweeps measured delegation
shape rather than trial adoption, and pi usage is still mostly pi
self-development, not an adoption signal. **Open**: revisit at the next
audit, or sooner once one harness clearly owns all interactive GPT sessions.
