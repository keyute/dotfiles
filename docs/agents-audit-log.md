# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`docs/agent-authoring.md` → Placement). An entry whose trigger has resolved
and whose baseline no longer serves a future sweep is deleted, not archived —
git history keeps it.

Pruned 2026-09-26 from 760 lines; `git show 79f042a:docs/agents-audit-log.md`
holds every entry cut or condensed.

## Pending owner decisions (2026-09-26)

- Fable effort cap: `modelSettings.claude-fable-5-1.maxEffortLevel: "high"`
  (clamps any request on Fable, blocks ultracode there; Opus keeps xhigh).
- `workflowSizeGuideline` value in settings.json.tmpl (unset = server default).
- Frontier hook: delete it after one denied `Agent(model:fable)` trial.
- After the Opus 5.5 driver probe: gate the implementation-slice bullet on
  driver tier > worker tier, recompute `native_coverage`, and confirm or drop
  the self_review precedence intent ("outranks a harness prompt discouraging it").

## Known residuals (pi)

From `docs/pi-implementation.md` → Verification and remaining gates (open
since 2026-09-15). Security first; each is fixed when its trigger fires.

- A timed-out approval does not cancel its queued classifier review.
  Trigger: a sweep shows approval timeouts, or a late verdict is ever
  applied to a later call.
- A minted ticket is bound to epoch/role/tool, not the reviewed arguments.
  Trigger: any change to ticket minting or the approval flow, or a pi
  release that lets arguments change between review and execution.
- A descendant that leaves the process group (`setsid`, double fork) or
  that another user owns escapes the terminal-proof group kill. Trigger: an
  orphan seen after a terminal-proof kill, or a role granted a command that
  daemonises.
- Follow-ups, each with its trigger: `handlePaste` cancels the completion
  menu (the owner hits it); `folds.*` grow for the session's life and
  `derive` rescans on every mutation (visible TUI lag in a long session);
  `forkContext` stays a full copy since the pruned mode fails the launch on
  a summary error (pi-subagents makes it non-fatal); fleet rows sit in the
  footer (pi makes dock order configurable); owned `wham/usage` read (it
  breaks — then read `@hk_net/pi-usage-bars`).

## 2026-09-26

### Usage and quota — owner data

`/usage` 2026-09-26: current 5-hour 1%, weekly all-models 19% (week started
~2026-09-25 13:00 AEST), weekly Fable 11%. Transcript breakdown since week
start (weighted units: input 1, cache write 1.25/2, cache read 0.1, output 5;
final record per message): workflow agents 67% (11 runs, all harness audits
of this repo), Fable driver sessions 15%, normal subagents 13%, Opus driver
4%. Workflow cost is 65% cache read, 27% cache write, 8% output; agents
median ~50 calls at 200–250k context. From now on triggers read
`scripts/agent-usage.mjs` output (owner-run; weighted units by
model|origin, per-role and per-workflow-run cost, skill tallies, pi cost)
instead of a manual `/usage` line.

- Worker effort confirmed, no change: implementer on Opus 5.5 `medium`
  median 17 calls / 0.18M weighted per dispatch vs Sonnet 5 `high` 34 /
  0.62M. **Watch**: researcher on Opus 18 calls at 123k context vs 7 on
  Sonnet; re-check at the next agent-usage run.
- Fable exposure: 0 forks in 30 days; the only Fable children were 5
  built-in Plan dispatches before the 2026-09-25 override (closes the
  2026-09-23 unattributed Fable child).
- Compactions: Claude 0 in 30 days; pi 10 in 10 days. pi week ≈ $294
  API-equivalent, Astra root 55%, OpenAI pool under no pressure.
- Skills, 30 days (Claude / pi): ship-check 38 / 23, cross-model-review 20,
  cross-model-advice 17, dep-audit 3 / 7, claude-api 11 (legitimate; closes
  the 2026-09-21 visibility question); readme-lean and align-sibling 0 on
  both → deleted 2026-09-26. **Open**: decide `run` visibility.
- pi `harness.md` loaded in 65 pi sessions via the over-broad "delegating a
  lookup" trigger; triggers narrowed and docs slimmed 2026-09-26 (baseline
  for the next count).
- pi-bridge: host-side git in a caller-chosen repo was an unsandboxed exec
  path; hardened 2026-09-26 (flags, env scrub, root refusal, SRT). Host probe
  2026-09-26: +13 ms per git call under SRT (21 vs 8.5 ms median), writes and
  network blocked; a hostile clean filter was refused `.env` and `~/.ssh` reads
  while status/diff exited 0 on a repo tracking `.env.example`.
- Exa: PERMS-6 ("denylist names unregistered tools") was wrong — `agent_*`
  ids exist in 3.4.1's registry, default-off; the denylist stays.

### (pi) Driver effort — resolved at `high`

Closes the replay item formerly under Measurable reversal triggers: Astra
stays at `high` (owner decision 2026-09-26; `medium` needs more turns). AA
GDPval turns/task low→max 12/19/21/23/24 and OpenAI DeepSWE cost per solved
task (medium $4.23, high $5.36) favour lower effort, but AA Terminal-Bench
4.0 favours `high` per completed task ($4.05 vs $4.43); `xhigh`/`max` were
never cheapest. Reversal: the weekly pi pool binds in 2 of 4 weeks, or a
matched replay shows `medium` ≤ 1.1x `high`'s turns.

### Model and effort data shape — one owner per fact

- Effort is model-relative (Opus 5.5 `medium` matched Opus 5 `high`, vendor
  guide): re-checked once at a tier when its pin moves. `general-purpose`
  keeps `high`: it nests and decomposes.
- Drivers are tier references (`agents.<harness>.defaults.tier`); the
  Claude→pi bridge sets its own `high`.
- No mid tier: Sonnet 5 medium (index 28, $1.00/task) is dominated by Opus
  5.5 low (42, $0.55), Terra 5.6 max (42, $1.40) by Sol 6 max (48, $1.06).

Adoption protocol: a slot is a role class; a new model lands in one slot or
none, moving a binding only when it is the cheapest meeting the slot's roles
at default effort; an out-of-slot purpose (the pi classifier) gets a named
binding. Reversal: add a tier key for a non-dominated model between tiers.

### (claude) Escalation ladder — effort first, then a fresh frontier session

`harness.md`: `/effort xhigh` first, then a fresh `claude --model <frontier>`
session, not `/model` in a grown session. The clause oscillated as an
always-loaded rule (fb4de68, ad28188, f40a69f, a71c5dd, 49b4cff) and now
lives only in the on-demand doc. Prompt-caching doc: "changing effort keeps
the cache"; "Each model has its own cache". `xhigh` (+2 index for 1.9x cost,
AA) stays a per-session bump. Reversal: `/model` keeps the cache, or
`/effort` stops keeping it.

### Driver ownership — two clauses leave the projection

"Unpinned children get the top tier" and "no child gets frontier" are
enforced (Claude's env pin and `Agent(model:…)` deny, asserted by
`render.test.mjs`; pi's roster and `children.mjs`). Reversal: a child seen
on the frontier model, or a release that routes around the deny.

### Measurable reversal triggers

Spec-reviewer-catch triggers retired: spec-reviewer runs the driver's model
since 2026-09-25, so its catches are same-model. Countable replacements:

- **Open**, next check 2026-10-03: `omitClaudeMd` on the Explore/Plan
  overrides — one Explore dispatch's first-turn input tokens after apply vs
  children 16.2k (2026-09-23); revert on a distilled-findings regression.
- Quota: baseline is the usage entry above; flip the Claude driver to
  `medium` if the weekly limit binds in 2 of 4 weeks.
- Frontier sessions: baseline Fable driver sessions 15% of the week's
  weighted usage; a doubling re-opens the driver choice.
- Opus 5.5 text-only end of turn on unattended runs (vendor watch item): in
  the driver, move `agents.claude.defaults.tier` to `frontier`; in top-tier
  children, revert `subagent_tiers.claude.top` to Opus 5.

### (pi) Approval classifier → GPT-6 Sol, both stages

Filter and judge moved from Terra 5.6 to Sol 6 (efforts unchanged) when the
2026-09-24 trigger fired: GPT-6 Astra system card, appendix 11.3.2, Figure
59 (indirect-injection defender success) Sol 6 99.05% vs Terra 5.6 96.68%;
Table 28 (instruction hierarchy) Sol 99.97%, Terra 99.939%. GPT-5.6 models
"remain available during the rollout", no date. pi-ai 0.87.1 maps Sol `off`
to `none`. The "one model keeps the judge's prompt a cache hit" rationale was
false and is dropped.

Gate before apply (owner-run, never executed): replay the 137-action TypeSafe
corpus through the Sol pairing. The corpus is not in this repo or its git
history: it was extracted from the pi session store's reviewed actions
(2026-09-16/17) and only its counts were recorded (2026-09-18 entry). Next
check 2026-10-03: the owner re-extracts that window, or a fresh week if the
store no longer holds it (then Terra is re-run on the same set). Reversal:
Sol's false-allow or false-deny count above Terra's → Terra 5.6 while it
remains in the catalog.

### (pi) Rate card and context window figures

- Credits per million input/cached/output: Astra 250/25/1250, Sol 50/5/250,
  Luna 2.5/0.25/12.5, Terra 5.6 50/5/300; Fast 2.5× (rate card 2026-09-26).
- 1,050,000 window is API-key only; subscription route 272,000 (pinned
  catalog). Trigger: the next SDK bump, or a live readout ≠ 272K.

### Roster — 14 roles kept

14 roles on Claude, 13 on pi. Overlap, not count, degrades routing:
selection stays above 90% up to ~20 options and degrades from ~30 tools or
10+ agents (arXiv 2601.04748, 2410.14594, 2505.03275, 2606.17519); one
near-duplicate per option costs 7–30%. Language reviewers are routed by
ship-check and stay all-or-nothing; pi-subagents' built-ins stay disabled.
Triggers:

- Fold the language reviewers into diff-reviewer only if a real-diff A/B
  shows no difference in verified catches.
- dep-researcher → researcher if dep-audit stops dispatching per dependency;
  Explore → explore-deep if the small tier stops being cheaper per task.
- Deny the built-in `claude` agent if dispatch counts show it chosen where
  `general-purpose` was intended.
- Re-open the count when description-routed roles approach ~20.

## 2026-09-25

### Claude driver → Opus 5.5; Fable 5.1 becomes escalation-only

Opus 5.5 at `high` under `modelSettings`; Fable 5.1 stays the frontier tier
so the deny keeps it off children. Evidence (no paired replay was run):

- Anthropic (2026-09-22): "performs at the level of Claude Fable 5.1 on most
  work"; use Fable "when your evals on Opus 5.5 at higher effort still fall
  short".
- [AA](https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-fable-5-1):
  max index 58 vs 53, $5.98 vs $7.63 per task; `high` 54 vs 51.
  [Snorkel](https://snorkel.ai/blog/opus-5-5-vs-opus-5-vs-fable-5-1-coding-benchmark-results/):
  pass@1 60.7 vs 61.5, runs passed 68% vs 49%, Fable failing by premature
  termination. PR review 8/14 at $15 vs 7/14 at $66 (every.to).
- Max metering: Fable ≤50% of the weekly pool; no multiplier published.

Reversal: re-run the frontier question if Anthropic lifts the Fable weekly
cap or a matched-effort long-horizon eval puts Fable ahead.

### Re-unified role matrix — one tier and one effort per role

`subagents.<role>` carries one `tier` and one `effort` for both harnesses;
`general-purpose` and `Plan` render as overrides of Claude's built-ins. AA:
Opus 5.5 medium 51 at $1.34/task, high 54 at $1.82; Sonnet 5 high 32 at
$1.79; Sol medium/high 40/43 at $0.25/$0.37. CodeRabbit: ordinary catches
51/80 vs 50/80, harder in-diff 8/13 vs 10/13 — medium lens reviewers are a
trial, not proven parity.

Dispatches, 45 days (Claude / pi): explore-deep 99/120, researcher 91/42,
implementer 84/83, diff-reviewer 64/34, spec-reviewer 49/53, ts-reviewer
48/30, Explore 37/25, dep-researcher 21/29, Plan 12/—, general-purpose 9/9,
go-reviewer 7/12, shell-reviewer 8/3, infra-reviewer 3/5, python-reviewer
0/1.

- A lens review that misses a catch restores `high` for that role.
- Re-tier Claude `small` when Haiku 5.5 ships.
- Fall back to `gpt-5.6-sol` for pi `top` if implementer round-trips rise.
- **Open**, next check 2026-10-03: `/agents` shows `general-purpose` and
  `Plan` as user overrides and `/tasks` shows `claude-opus-5-5` for both
  (fallback: the `Agent(model:fable)` deny); the Claude-side
  `agent-instructions-audit` after the model change is due the same date.

## 2026-09-23

### Fresh-session audit — sweep baselines

Claude Code 2.1.280, pi SDK 0.87.1: no ADD, no new SHAVE, no CONFLICT; the
coverage matrix is recomputed each audit. Initiative and docs_mcp shaves
stand on the 2026-09-15 rationale.

- Over-testing: vendor-documented for GPT; the 2026-09-20 replay saw
  2.8–3.5× the shipped test lines on GPT arms (Claude 1.2×) with
  scope_extras projected. **Open**: if the next same-prompt replay again
  shows GPT above 2×, adopt the vendor's "do not write tests for reversible,
  low-impact changes that mirror the implementation".
- Claude store (09-17..23): 43 of 68 root sessions editing; no review of any
  kind in 14/43 (33%; 41% on 2026-09-09); cross-model review in 16/43, no
  longer displacing the subagent pass. Edit+Write root 464 vs child 573.
  First-turn context: root median 37.3k (34.5k after the local-only apply);
  children 16.2k (n=302). Latest `message.model` sample: Sonnet 5 6,337
  rows, Haiku 1,561, Opus 5 1,322 (pre-apply pin).
- pi store (09-16..22): 17 of 56 root sessions editing, no review in 1/17;
  328 launches, root `status`+`list` 0.35 per launch; Edit+Write root 188 vs
  child 445; root first turn 11.4k, children 4.4k–4.8k. **Open**, next pi
  audit: nested-child polling after the `bg_wait` grant (baseline 154 polls /
  5 launches, 0 `bg_wait`).

### (claude) Cross-model consultation yield

Claude store 09-17..22: `review` 20 calls in 17 sessions plus 17 `reply`;
`advise` 15 in 9 sessions. Review: ~30 findings real and fixed across 15
sessions, 2 no findings, 1 rejected; re-reviews added 5; four catches no
other pass made (e.g. the pi-ai WebSocket continuation key). Advise: every
read used. The trigger stays risk-or-breadth;
"in addition to" answers the displacement (68% on 2026-09-09). Re-count
method: per `mcp__pi__review` tool_use, tally real/fixed vs rejected from
later assistant text; ten reviews is the denominator. **Open**, next check
2026-10-03: one `review` through the hardened `scripts/pi-bridge.mjs` and the
guard's block of `~/.pi/agent/auth.json`.

## 2026-09-21

- **Open**: a second write-capable specialist only if a sweep shows
  implementer round-trips or per-call overrides rising.
- **Open**: spawn-together (left in 7de30aa; `call_batching` overlaps) is
  re-added only if a sweep shows independent, exclusive-scope strands run
  serially.

## 2026-09-20

### (pi trial) Paired replay — decision record

Six shipped commits replayed at the parent SHA, graded gate-green then
blinded pairwise by spec-reviewer. pi: gates 6/6, 2 wins, 2 ties, 2 slight
losses; credits −42%, root calls 151 vs 252, active time +28% from child
wait (42.6 vs 20.3 min, implementers strictly sequential). pi became daily
driver (2026-09-23); n=6 is a canary. Codify the protocol into the audit
skill only after it runs twice unchanged. **Open**, next pi audit: fix or
accept the sequential-child wait from its launch-overlap count.

## 2026-09-18

### (pi) Delegation sweep

2026-09-16/17: 38 root sessions, ~260 child runs, zero on Astra. Spend root
≈ $254 of ≈ $338 (pi's estimate), mostly cache reads of a long context.

- Per agent (runs / child $ / post-report root re-reads of child-read
  paths): explore-deep 79 / 22.6 / 450 of 1,583 (~28%); implementer 36 /
  11.8 / 50; spec-reviewer 28 / 13.1 / ~2; general-purpose 5 / 16.2 / 11;
  Explore 15 / 0.12; dep-researcher 29 / 0.58.
- During-run duplication (`delegation_wait`): ~35 root reads of child-read
  paths across all runs — closes the 2026-09-12 item behind the
  delegation-wait why (full text at 79f042a).
- Completion-guard false failures fixed (`docs/pi-implementation.md`
  2026-09-18). **Open**, next audit sweep: post-report re-reads of Explore
  paths and general-purpose on implementation-shaped work.

### (pi) TypeSafe Jev replay against the approval classifier

137 reviewed actions (122 escalations, 15 sandboxed verbs) plus 16
hand-labelled adversarial cases through TypeSafe `jev-1.13.0`: all 10
must-not-allow cases held; sandboxed verbs (11% of reviews) fast-allow 11/13
at ≥ 0.7 with zero wrong allows; escalations 5/91 at ≥ 0.7, 24/91 at ≥ 0.5
with two wrong allows; p50 257 ms, 466k input tokens. Not adopted; trigger
in `docs/pi-implementation.md` 2026-09-18. Cheaper lever first: hand the
judge the retry-after-sandboxed-failure fact from `history`.

### (pi) Classifier pairing and second-vendor evaluation

- Claude Code auto mode runs both stages on one model (Anthropic
  engineering post, 2026-03-25). Wire: pi-ai maps `minimal` to `low`; `none` reaches the wire. The filter's
  `maxTokens: 256` also holds reasoning; a truncated reply parses as `ask`.
  The classifier is pinned to SSE: its `sessionId` would clear the root's
  WebSocket `previous_response_id` delta.
- Spend by tier: root ≈ 75%; children Sol ≈ $29, Terra ≈ $54, Luna < $1.
  OpenCode Go ($10/month, per-model caps $15–60, pi-validated): the Terra
  roles' 2-day window would spend a week of one model's cap.
- **Open**, next check 2026-10-03: per-stage latency of the Sol pairing with
  the filter's `stopReason`, forward rate, judge verdicts after a failed
  sandboxed attempt, cached-input tokens on the judge, and `none` accepted on
  the wire. Luna fallback and second-vendor triggers:
  `docs/pi-implementation.md`.

## 2026-09-15

### Review of 49b4cff — sources behind the principle whys

Fable-driver-era frontier evidence superseded on 2026-09-25 is cut.

- Delegation: GPT-6 Astra guide — "may delegate less often than desired…"
  (keeps the rule projected on pi); lilting.ch 2026-09-07 — Astra "promoted
  every task to itself"; martinfowler.com 2026-07-16 — the orchestrator tax
  is reading verbose child output.
- Routing issue history (Claude harness doc): claude-code#91220 (one resumed
  16.7h subagent = 50.7% of a Max 20x week, 227.8M cache-read vs 72K
  output), #84667 and #75055 (unpinned child fan-out), #75054 (pins lost on
  background resume), #85592 and #91160 (env var overrode per-call requests
  before 2.1.251), #82252 (override served by another model).
- Self-review: models fix a bug told it is someone else's but not their own
  (64.5% blind spot, arXiv 2507.02778); self-review endorses ~32% of its own
  behaviour-changing output (2605.21537); fresh-context review beats
  same-session (F1 28.6% vs 24.6%, 2603.12123); iterated rounds add false
  positives faster than catches (precision 0.30→0.20, 2603.16244). The
  2026-09-12 sweep (13 spec-reviewer runs, 4–5 zero-finding at ~51k tokens,
  one re-review 35 min later, 1 high + 3 medium catches all on high-stakes
  surfaces) is the source of the skip and fix-scoped re-review carve-outs.
  **Open**: next sweep re-counts zero-finding share and re-review scope.
- Cross-model: a size-only trigger fired ~20x more often while its hit rate
  fell from ~4% to under 1%. Initiative: OpenAI (Astra) and Anthropic (Fable
  5.1) document stopping to ask where persistence is expected; GPT-5.6's
  guide finds repeated approval wording causes approval requests. Shaved on
  Claude (native), as is docs_mcp (context7 server instructions).
- Density: Anthropic memory doc (under 200 lines); OpenAI
  harness-engineering 2026-02-11 (~100-line AGENTS.md); arXiv 2602.11988
  (context files +20% cost, no general gain); 2608.12426 (compliance
  collapses past 5–6 constraints); Fable 5 guide "Give the reason".
- Merges, so the next audit does not re-add them: tier_selection →
  driver_ownership; fan_out → delegation_contract; community_search →
  web_search.

### (pi) Cost read — Astra-default baseline

Session `01a0848e` (2026-09-09): 192.9k uncached input, 2.26M cache reads,
10.5k output, $4.71 (≈118 credits), 40 turns, 10 children, peak root 99.9k,
all on Astra; the same trajectory on Sol ~$1.88 (2.5×). Token spend tracks
child count (4.5× between 3 and 8 children), not harness. Trigger: when the
weekly pi pool binds, compare Sol and Astra on matched completed tasks.

## 2026-09-12

### (claude) Delegation economics — research

Subagent tokens draw the same Max 5h/weekly pools as the main loop — no
subagent discount. Drain is model-weighted: "Opus reaches limits ~5x faster
than Sonnet" (support article, archived 2025-10-02), unreconciled with the
2.5x API input ratio. Cache reads are 0.1x in API billing (0.025x on
Fable/Mythos 5.1); whether Max metering discounts them is documented
nowhere. Delegation multiplies tokens (multi-agent ≈15x chat, single agent
≈4x, teams ≈7x) and pays only via tier arbitrage and keeping a grown
top-tier context from re-metering. Anthropic's cost guide: delegate past one
context window or across independent items; on DeepWideSearch lower effort
beat orchestrator+workers (20% cheaper). The selective gate stands. 2026-09-26: cache reads
are 65% of workflow-agent weighted cost at the assumed 0.1x. **Open**:
reconcile `/usage` against agent-usage's weighted units the first week a
limit binds.
