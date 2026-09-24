# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`AGENTS.md` → Placement). An entry whose trigger has resolved and whose
baseline no longer serves a future sweep is deleted, not archived — git
history keeps it.

## 2026-09-24

### Per-role effort decision — Opus 5.5 / GPT-6

Per-harness role decision, not a quota/quality trial; tier maps/policy hold:

| role | Claude tier / effort | pi tier / reasoning |
|---|---|---|
| driver | Fable 5.1 / high (explicit settings `effortLevel`) | Astra / high (unchanged) |
| Explore / explorer | Haiku 4.5 / unsupported | Luna / low |
| log-triager | Haiku 4.5 / unsupported | Luna / medium (was low; root-cause diagnosis) |
| dep-researcher | Opus 5.5 / medium (was Haiku) | Luna / medium (unchanged) |
| explore-deep, researcher, implementer | Opus 5.5 / medium (unchanged) | Sol / medium (unchanged) |
| go-, python-, ts-, shell-, infra-, diff-reviewer | Opus 5.5 / medium (was high) | Sol / high (unchanged) |
| spec-reviewer | Opus 5.5 / high | Sol / high |
| general-purpose | Opus 5.5 / session effort (native unpinned env fallback) | Sol / high (managed) |

Claude native Plan/general-purpose inherit effort; guide is Haiku, statusline
helper Sonnet, forks parent. Claude mid/top share Opus; pi mid/top Sol.
Two pi dep-researcher small→mid overrides (2026-09-23) motivated medium.
Reviewer reduction is a trial, not a measured high-effort quality failure.

[Artificial Analysis Claude comparison](https://artificialanalysis.ai/models/releases/comparisons/claude-opus-5-5-vs-claude-sonnet-5)
(2026-09-24): Opus 5.5 medium index 51, 26k output/task, API $1.34/task;
high 54, 36k, $1.82; Sonnet 5 high 32, 44k, $1.79. High→medium is ~26%
less *API task cost* for Opus on that test, not a Max quota conversion or
review-recall result. [CodeRabbit's review pipelines](https://www.coderabbit.ai/blog/opus-5-5-model-review)
compare Standard / Max, **not API effort levels**: ordinary catches 51/80 vs
50/80, precision 38.6% vs 35.7%; harder in-diff catches 8/13 vs 10/13,
full-stream catches both 10/13 including outside-diff. This warrants a
medium-default reviewer experiment, not parity or safety claims. Anthropic's
[2026-09-22 task-cost guidance](https://claude.com/blog/what-a-task-costs-on-opus-5-5)
recommends medium for scoped daily work, high when medium stalls, smaller
models for lookups/logs, and Fable for hard unsupervised orchestration. It
attributes ~25% more subscription capacity vs Opus 5 to lower Opus 5.5
pricing including cached context; the extra *API* cache discount is not a
subscription benefit. [Fable plan guidance](https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan)
says its 50% weekly cap is shared usage, not reserved/additional capacity;
it drains faster with no published fixed multiplier. [Every's early-access
report](https://every.to/vibe-check/vibe-check-opus-5-5-is-pulling-our-codex-converts-back-to-claude)
reports positive daily coding but keeps Fable for hard cases and notes runaways,
unfinished work and false greens; seven early-access and two public days are
not consensus. No exact Sonnet/Opus 5.5 Max conversion is published.

[Artificial Analysis Sol comparison](https://artificialanalysis.ai/models/comparisons/gpt-6-sol-high-vs-gpt-6-sol-medium):
medium/high index 40/43, reasoning 2k/5k, API $0.25/$0.37 per task;
Terminal-Bench 19%/26%, **not reviewer recall**.
[Luna low/medium](https://artificialanalysis.ai/models/comparisons/gpt-6-luna-medium-vs-gpt-6-luna-low):
index 21/29, reasoning 515/6k, API $0.0045/$0.02 per task. The live
[credit card](https://learn.chatgpt.com/docs/pricing) lists Astra
250/25/1250 and Terra 50/5/300 credits per 1M but omits GPT-6 Sol/Luna;
repo Sol 50/5/250 and Luna 2.5/0.25/12.5 rows are historical, **not
reverified** on 2026-09-24. API $ is not observed subscription drain.

Reversal: compare same-snapshot actionable catches, critical misses,
false-positive work and accepted output including retries, input/cache,
reasoning/output, parent repairs and observed allowance. Restore Claude
reviewers high if an important catch is lost; reassess tiers on new models
or changed allowance/round-trips. No automatic paid trial or session read.
Claude-side `agent-instructions-audit` required after model change; not run.

Classifier stays Terra: retired injection metric; instruction-hierarchy
results are not comparable. The agents.yaml trigger stands.

Prior-apply probe (2026-09-24, CLI 2.1.280, three child `message.model`):
general-purpose served Opus 5.5, Explore/guide Haiku 4.5; no Fable. Not
verification of new effort. **Open**: Fable/Opus driver replay (three cases,
2026-09-20 protocol); Opus text-only-stop; Sol DeepSWE if round-trips rise.

## 2026-09-23

### Fresh-session audit — Opus 5.5 / GPT-6 roster, vendor-guide check

Skill steps 1–4 and 6; step 5 pending the user-run store pipelines (below).
Claude Code 2.1.280, pi SDK 0.87.1. Cross-model cross-check on the pi bridge
(thread `ce600ac8`), run prompt-free from plan mode.

- Probes. Served IDs: driver one-shot `claude-fable-5-1`; children by
  self-report `claude-opus-5-5[1m]`, `claude-sonnet-5`,
  `claude-haiku-4-5-20251001`; one-shots of all four Claude pins answered.
  pi pins `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-terra` present in
  the SDK's `openai-codex.json` catalog — `pi --offline --list-models` printed
  nothing from the sandbox (availability filter on the denied auth store);
  the skill now greps the catalog. pi static prompt (0.87.1 `system-prompt.js`
  carries only "Be concise" / "Show file paths"; the managed workflow adds
  the plan-mode research clause and edit-tool guidelines; the subagent tool
  description carries contract fields, "do not poll or wait just for a wake"
  and "models are pinned; pass model only to escalate"): every principle
  absent or partial, none contradicted. Probe noise: Haiku quoted the
  projection's long_running_work line as harness evidence (read as partial);
  Sonnet called commit_etiquette "contradicted" on "When the user asks you to
  create a new git commit…" — a condition, not an opposition.
- Matrix (F/O/S/H/pi = Fable 5.1, Opus 5.5, Sonnet 5, Haiku 4.5, pi static;
  c/p/a): context_hygiene c/c/c/a/a; delegation_contract p/p/p/p/p;
  delegation_economics p/p/p/a/a; frontier_driver a/a/a/a/p; delegation_wait
  c/c/p/c/p; docs_mcp c/a/a/a/a; playwright, web_search a everywhere;
  user_run_commands c/a/a/a/a; simplicity a/p/a/a/a; style_matching,
  comment_discipline, test_discipline, test_integrity, review_focus,
  self_review a everywhere; targeted_edits p/p/c/p/p; scope_extras p/p/a/a/a;
  faithful_reporting c/p/p/p/a; initiative c/p/a/p/p(plan mode only);
  partial_delivery c/p/a/a/a; call_batching c/c/c/c/a; long_running_work
  c/p/c/p/a; convention_recording p/a/a/a/a; credential_hygiene c/p/p/p/a;
  commit_etiquette c/p/c/c/a; cross_model_* a on Claude. Verdict: no ADD, no
  new SHAVE, no CONFLICT, no HARNESS-CONFLICT; `native_coverage` unchanged.
  call_batching shave confirmed on all four Claude classes (Haiku re-probe);
  initiative and docs_mcp shaves stand on the 2026-09-15 rationale.
- Vendor guides (fetched live). Anthropic: Fable 5.1's fix texts for
  initiative, call_batching, partial_delivery and scope_extras are carried
  verbatim by the Claude Code prompt or the projection; its whole-file
  rewrite regression keeps targeted_edits projected. Opus 5.5: text-only end
  of turn on long unattended tasks (watch item for top-tier children); "at
  its default `medium` effort the model matched or beat Claude Opus 5 at
  `high`… in fewer steps and with fewer tokens". Former high-effort
  reviewer trigger superseded by 2026-09-24. Haiku 4.5 has no model page.
  OpenAI: one GPT-6 family page, observed
  on Astra; Sol and Luna have no guidance of their own. Its initiative and
  under-delegation notes underwrite lines already projected on pi. Over-
  testing ("broader tests than the task requires") is vendor-documented and
  a same-prompt replay (2026-09-20, entry pruned) saw 2.8–3.5× test lines on
  GPT with the scope_extras line projected; the cross-check disputed a reword
  — the replay measured lines added, not repeated testing after green. **Open**: if the
  next same-prompt replay again shows GPT arms above 2× the shipped test
  lines with the line projected, adopt the vendor's "do not write tests for
  reversible, low-impact changes that mirror the implementation" phrasing in
  baseline and projection. Astra's "make the priority of user instructions
  and skills explicit" has no pause-and-block failure on record. GPT-5.6's
  "favor leaner prompts" (vendor-internal 10–15% eval gain, 41–66% fewer
  tokens) and its warning that repeated approval wording causes approval
  requests support the density doctrine and the initiative decision.
- Bodies and docs (historical 2026-09-23 snapshot). No contradictions, native duplicates or stale mechanics;
  the approval gates in `ship-check`, `align-sibling` and both repo-local
  skills are deliberate. The two cross-model skill bodies carried Claude
  nouns in the shared templates directory with one Claude consumer each —
  inlined into `private_dot_claude/skills/*/SKILL.md`, shared copies removed,
  renders byte-identical. The Sol 50/5/250 and Luna 2.5/0.25/12.5 credit rows
  recorded then were not reverified in the 2026-09-24 live card (above).
  Docs lint was green before and after that earlier change.
- Cross-check (pi advisor): agreed on the verdict and every edit; disputed
  the scope_extras evidence reading (accepted, recorded as the open trigger
  above); asked that the catalog grep never be read as a served pin.
- Sweep, Claude store (user-run `jq` pipeline, tool_use metadata only; the
  store held 2026-09-17..23, 7 days not 30): 68 root sessions, 43 editing
  (≥3 Edit/Write). Fresh-eyes pass: spec-reviewer in 22/43 editing sessions
  (32 dispatches); cross-model review in 16/43 (21 `review`, 18 `reply`,
  15 `advise` on the previous bridge); both in 14; no review of any kind in 14/43 (33%,
  against 41% on 2026-09-09 and 1/13 on 2026-09-12) — the cross-model pass
  no longer displaces the subagent pass. `mcp__pi__*`: 2 calls (this audit's
  `advise` + `reply`, both used). Implementer: 43 dispatches in 18 editing
  sessions; Edit+Write root 464 vs child 573 (Sep 17–21 was 231/280; Sep 15
  86/61). Overrides per subagent_type: general-purpose 6/6 (3 are this
  audit's probes), built-in Plan 5/6 (`opus`), every roster specialist 0 —
  no roster friction. Children's `message.model`: Sonnet 5 6,337 rows, Haiku
  1,561, Opus 5 1,322 (the pre-2026-09-23 top pin; one child on 09-23 still
  ran Opus 5, 48 calls, from a session that predates the apply — the applied
  agent files and `CLAUDE_CODE_SUBAGENT_MODEL` both read `claude-opus-5-5`);
  Fable 18 rows in one subagent transcript on 09-22 (18 Bash calls), with no
  root `Agent` call carrying a model override that day and no skill running
  in a fork — unattributed. First-turn context (first assistant usage
  record per file, input + cache write + cache read): root median 37.3k
  (n=68, 22.2k–50.0k); split at the 2026-09-21 local-only settings apply,
  37.6k before (n=49) vs 34.5k after (n=19, min 31.8k) — about 3k saved, the
  hidden bundled skills and denied tools; children 16.2k (n=302). Not
  measured here: zero-finding share and catches (content).
- Sweep, pi store (same method; 2026-09-16..22, includes the 6 replay
  sessions): 56 root sessions, 17 editing; spec-reviewer in 16/17,
  implementer in 14/17, no review of any kind in 1/17. 328 launches in 52
  sessions (explore-deep 93, implementer 56, spec-reviewer 39, researcher
  31, ts-reviewer 27, dep-researcher 29, explorer 19, diff-reviewer 19,
  general-purpose 9); root `status`+`list` 114, 0.35 per launch (0.5 on
  2026-09-12). Edit+Write root 188 vs child 445. Overrides: 2 dep-researcher
  → `gpt-5.6-terra` (small → mid escalation, pre-GPT-6), nothing else.
  Nested: 5 child launches against 154 child `status`/`list` calls and 0
  `bg_wait` — the nesting child polls; the data predates the 2026-09-22
  `bg_wait` grant to nesting roles. Plan mode: `ask_user_question` in 29/56
  sessions (51 calls), `submit_plan` 66. **Open**: nested-child polling
  after the `bg_wait` grant (baseline 154 polls / 5 launches); map that Fable child to its parent (slice the path to
  `<session>/subagents/<file>` next time) and name the spawn path the
  deny-frontier hook cannot see;
  spec-reviewer catches and zero-finding share at Opus 5.5 vs the 1 high + 3
  medium of 13 baseline; Opus 5.5 text-only stops in top-tier children.

### New-model placement — Opus 5.5, GPT-6 Sol and Luna (all released 2026-09-22)

Roster decision, no audit run: the audit itself runs in a fresh session
against these pins. Evidence was same-day Artificial Analysis at `max`
effort plus vendor pages; the table and per-effort figures now live in the
2026-09-24 entry, which supersedes the max-only rows. Opus 5.5: API default
effort `medium`, thinking cannot be disabled, forced `tool_choice` 400s,
Claude Code ≥ 2.1.280 (installed). Pi SDK 0.87.1 (2026-09-22) is the first
catalog with the GPT-6 tiers and Opus 5.5; pinned from 0.87.0 in the same change.

- Claude top → `claude-opus-5-5`; frontier stays Fable 5.1. Opus 5.5 at max
  outscores Fable 5.1 at max on the same day at 0.4x the price, but uses ~1.5x
  the tokens per task, and the frontier/top split carries the frontier_driver
  rule and the deny-frontier-child hook. **Open**: paired replay (3 cases,
  same-prompt clones at the parent SHA, gate-green then blinded pairwise)
  Fable 5.1 vs Opus 5.5 as driver; swap if Opus 5.5 holds gate-green and
  pairwise at lower cost per completed task.
- pi small → `gpt-6-luna`, mid and top → `gpt-6-sol`. Sol 6 dominates Terra
  5.6 on every axis, so mid == top; reverse mid when a GPT-6 Terra ships or
  verified Sol subscription credits exceed Terra's 50/5/300. Classifier stays Terra
  5.6 (criterion: injection resistance); the appendix trigger is restated in
  the 2026-09-24 entry.
- Prompting-guide deltas, gated before the next audit: Opus 5.5's unattended-
  run clause and progress-update reminder map to `initiative` and the harness
  prompt; its multi-agent elapsed-time budget has no observed failure (doc
  note at most); GPT-6's ask-vs-assume, under-delegation and over-testing
  notes map to `initiative`, the delegation rule and scope of extras. No
  candidate clears gate 1 today.
- Opus 5.5 child class, all eight pins and the 0.87.1 prompt sources were
  probed by the fresh-session audit; Sol/Luna credit rows remain unverified.
  **Open**: first `mcp__pi__*` sweep once the bridge is applied.

### (claude) Cross-model consultation yield

Transcript count over the Claude store (2026-09-17 to 09-22, 358 session
files, user-run extraction because the auto-mode classifier denies the driver
an unsandboxed store read, on the previous cross-model bridge): `review`
20 calls in 17 sessions plus 17 `reply` rounds; `advise` 15 calls in 9
sessions.
Dispositions were read from each session's own later verdict text, not from
the bridge output (the tool_result holds only the "moved to background"
notice; the response arrives as a task notification).

- Review: ~30 findings verified real and fixed across 15 sessions; 2
  sessions returned no findings; 1 session rejected its only finding;
  re-review rounds added 5 more real findings. Catches no other pass made:
  the pi-ai WebSocket continuation key (2026-09-18), an employee-login
  enable on a non-active create (2026-09-18), the CNPG primary update method
  and the Mimir ruler self-series (2026-09-22). Breadth-triggered bodies (pi
  TUI, dashboard work) were among the highest-yield sessions.
- Advise: every read was used; adopted catches include a harness config
  form, pi's `!` sandbox scope and a bundled `design-sync` skill; the
  rest confirmed the plan or sharpened its strongest counter-argument.

Supersedes the 2026-09-12 "1 review / 0 survived" count and its ten-survivor
trigger, which could never fire on a low-yield mechanism (survivors, not
reviews, were the denominator). Decision: the trigger stays risk-or-breadth.
Method for the next re-count: per `mcp__pi__review` tool_use, collect the
session's later assistant sentences naming the reviewer and tally
real/fixed vs rejected; ten reviews is the denominator.

The review backend is `scripts/pi-bridge.mjs` (harness.md) since
2026-09-23; read isolation rests on the bridge's `tool_call` path guard.
`advise` and `reply` ran prompt-free from plan mode on 2026-09-23 (audit
entry above). **Open**: after apply, verify one `review` and the guard's
block of `~/.pi/agent/auth.json`; first re-count of survived findings at
the next audit.

## 2026-09-21

### Context floor and tier routing — transcript count

Counts only, session files modified in the prior 11 days (Claude 211, pi 675).
First-turn context = first assistant usage record per file (input + cache
write + cache read).

- First-turn median tokens. Claude root 37.6k (22k–48k, n=43), children 12.0k
  small / 16.3k mid / 14.2k top. pi root 11.4k (min 8.6k, n=51), children
  4.4k–4.8k (n=312).
- pi verdict: no further meaningful saving. MCP is lazy (one `mcp` proxy;
  `addedToolNames` fired in 17 sessions for context7, 3 for Exa); the two
  remaining always-loaded items — the ≈1k-token roster in the `subagent` tool
  description and the ≈1.5k-token baseline children inherit — are deliberate.
- Pins. Claude child messages: mid 2136, small 637, top 505, frontier 0.
- Implementer open (c), measured before this day's description change applies:
  dispatches Claude 20, pi 52; Claude writes Sep 17–21 root 231 /
  child 280 (Sep 20 alone: 112 / 64).
- Claude local-only decision (harness.md): 0 invocations of any account-synced,
  Chrome, scheduling or dataviz skill in the window; skills used were
  cross-model review 10, cross-model advice 5, claude-api 1,
  agent-instructions-audit 1.
  Effort-per-role research (one published config: same-tier implementer medium
  / reviewer high; no source measures effort against review yield) changed
  nothing in the roster.
- Re-counted 2026-09-23: root 34.5k after the apply (entry above).
  **Open**: decide `run` / `claude-api` visibility.

### Implementer roster — no top-tier implementer; mid remit widened

Decision: one write-capable specialist stays. Its description now covers any
bounded slice of a settled design, not only mechanical change; the baseline
already assigned that work to "the lowest capable pinned worker", so the
description was narrower than the intent and the baseline is unchanged. The
repair rule ("finish a failed worker's piece yourself, not via promotion")
stands. Evidence: four `researcher` runs; Willison, Cognition and CodeRescue
re-fetched by the driver, the rest as reported.

- Executor tier. Willison's memory file (simonwillison.net/2026/jul/3/judgement/,
  first-hand): Sonnet for "substantive implementation", Haiku for
  "trivial/mechanical edits", main model keeps "design, auditing… anything
  judgment-heavy"; "implementation work rarely needs the top-tier model".
  Claude Code `opusplan` (code.claude.com/docs/en/model-config): strongest
  model plans, Sonnet executes — design intent, not a benchmark. Aider
  architect/editor (2024-09-26, 2025-01-24; controlled, pre-2026 models):
  strong planner + cheap editor 85.0% vs 79.7% solo; R1+Sonnet at 14× lower
  cost than the o1 SOTA. Leiva (andresleiva.com, 2026-07-11): Opus
  orchestrates, Sonnet implements from file-and-symbol-level briefs. No
  credible setup found delegating implementation to a near-frontier worker
  under a stronger orchestrator.
- Contradiction the change removes. The old description said "NOT for …
  judgment-heavy implementation" while the projection told the driver to
  delegate every non-trivial settled slice. OpenAI's Astra guide: the model is
  "more sensitive" to conflicting guidance and "may delegate less often than
  desired… specify when and how much"; Anthropic's Fable 5 guide: "provide
  explicit guidance about when delegation is appropriate".
- Failure handling. Neither vendor documents what to do when a worker's output
  fails verification (Claude Code covers API-error retry only). CodeRescue
  (arXiv:2607.19338): cheap recovery and escalation "exhibit complementary
  success patterns", same solve rate as always-escalate at 35% of its recovery
  cost — GPT-5.4-nano/GPT-5.4, and the paper is withdrawn, so low weight.
  Cognition (Yan, 2026-04-22): multi-agent works where "writes stay
  single-threaded"; a weaker primary fails at "knowing when to escalate".
  Steinberger's write-free orchestrator is known only through secondhand
  summaries. Nothing supports a mid → top → frontier ladder.
- Break-even. One practitioner figure (dev.to/rulestack, 2026-08-20): spawn
  fixed cost ~54k tokens, self-corrected from 436k in its own thread —
  direction only. arXiv:2606.17099 (n=64): explicit delegation contracts left
  task success unchanged and raised reviewability, +13% tokens, effect ~2×
  larger on the weaker tier.
- Unmeasured anywhere found: orchestrators over-selecting the most expensive
  worker tier; brief detail required per worker tier.
- OpenAI tier positioning (vendor subagents doc): Sol "for ambiguous,
  multi-step work", Terra for "exploration, read-heavy scans", Luna for
  "clear, repeatable, or high-volume work" — the OpenAI-side implementer sits
  below that positioning, against 36 pi implementer runs on Terra with no
  tier-attributable quality finding (2026-09-18 sweep; one run changed
  nothing and was rejected).
- **Open**: (a) add a top-tier implementer only if a sweep shows recurring
  model overrides or failed round-trips on `implementer` dispatches for
  settled-design slices; (b) count Terra implementer failures on pi — a
  per-harness tier, not a new role, is the first lever there;
  (c) re-measure `implementer` dispatches and root inline edits after the
  description change (baselines: 0 dispatches / 374 inline edits Sep 11–12; 4
  dispatches, 86 root / 61 child writes Sep 15; 20 dispatches, 231 root / 280
  child writes Sep 17–21, entry above).

### Delegation audit over the paired replay (scoped run)

Scope: delegation contract, delegation wait, review stacking, initiative,
roster. Evidence: the 2026-09-20 replay's `rows.json` plus tool-call metadata
from its transcripts. Probes: Claude self-probe (Fable 5.1), pi static; worker
classes skipped — every scoped rule is driver-only. n=6, one run per arm.

- pi had one multi-implementer run, not three: in runs 2, 4 and 6 the second
  `implementer` launch replaced one plan mode had refused; pagination's second
  slice consumed the first. pi has no concurrency guard (limits 20, launches
  forced async) and made 0 `bg_wait` calls.
- Matrix. Wait-once: Claude covered, pi covered (tool description) → no ADD.
  Spawn-together: Claude and pi covered → not added — `call_batching`
  overlaps, and the clause left the projection in 7de30aa with no reason
  recorded, so re-adding it six days later is oscillation. Self-review and
  cross-model review: both fired as written, each line already reworded twice
  → KEEP.
- Not wording: test over-building is equal on both GPT arms with the line
  projected; pi's refused early implementer launches (3 of 6 runs) are a
  workflow follow-up.
- **Open**: spawn-together gets an ADD only if a sweep shows independent,
  exclusive-scope strands run serially.

## 2026-09-20

### (pi trial) Paired replay — decision record

Same-prompt replay of six shipped commits (2 bugfixes with a test gate, 2
small features, 1 refactor, 1 config/infra), each arm in a standalone clone
at the parent SHA with the shipped commit pruned; graded gate-green first,
then blinded pairwise "which would I merge" by spec-reviewer. pi against the
previous review-backend harness on the same model and effort; Claude on three
as a ceiling reference only. Working files stayed under `$TMPDIR`.

- pi: gates 6/6 green; pairwise 2 wins, 2 ties, 2 slight losses (one tie
  adjudicated from a slight loss because the reviewer penalised a test move
  the repo's own instructions require). Credits −42%, root model calls 151 vs
  252, questions to the user 1 vs 4, active turn time +28% — the extra time
  is child wait (42.6 vs 20.3 min): pi ran implementers strictly in sequence.
  Both GPT arms over-build tests alike (added lines 2.8× and 3.5× the shipped
  diff; Claude 1.2×), so that is the model, not a projection gap.
- Decision: pi adopted as daily driver (harness change 2026-09-23). n=6 with
  one run per arm — a canary, not a measurement. **Open**: the
  sequential-child wait is the thing to fix or accept. Codify the protocol
  into the audit skill only after it has run twice unchanged for a second
  decision, and script a runner only after that.

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
  baseline change only if they persist — which needs the claude sweep the
  audit skill owns, not this pi-only sample. Nested-child polling
  stays a one-off watch item.

### (pi) TypeSafe Jev replay against the approval classifier

Replayed 137 reviewed actions (122 unsandboxed escalations, 15 sandboxed
reviewed verbs) plus 16 hand-labelled adversarial and boundary cases through
TypeSafe `jev-1.13.0` as one Choice `{allow, deny, ask}` under the live
`SYSTEM_PROMPT` plus four speculative Nouls.

- Corpus split: 122 escalations / 15 sandboxed verbs; observed 104 allowed,
  7 denied, 1 timeout, 25 ran-and-failed.
- Safety: all 10 must-not-allow cases held — injections denied at confidence
  ≈ 1.0; both labelled misses fell on the safe side.
- Coverage: the sandboxed slice fast-allows 11/13 observed-allowed at
  confidence ≥ 0.7 with zero wrong allows, but that slice is 11% of reviews.
  Escalations: 5/91 at ≥ 0.7; 24/91 at ≥ 0.5 with two wrong allows.
- Latency p50 257 ms, p90 364 ms, max 843 ms; 466k input tokens, $0.02.
- Decision: not adopted (`docs/pi-implementation.md` 2026-09-18) — the
  addressable slice is too small for a second vendor, key, egress and client
  inside the security gate. **Open**: the per-stage measurement of the
  single-model classifier (next entry) comes first. Reconsider only if it
  misses, escalations stop dominating reviews, and a fresh replay clears
  the escalation slice at ≥ 0.7 with zero wrong allows. Separate lever seen
  here: the retry-after-sandboxed-failure shape is detectable in code from
  `history`; handing the judge that fact instead of leaving it to infer it
  is the cheaper latency experiment before any model swap.

### (pi) Classifier pairing and second-vendor evaluation

Research pass over both vendors' approval gates, OpenAI's GPT-5.6 system
card, plan and model pages and OpenCode Go, plus a trace of pi-ai's
`openai-codex` driver; decisions in `docs/pi-implementation.md` 2026-09-18.

- Vendor gates: Claude Code auto mode runs both stages on Sonnet 4.6, stage
  two reusing stage one's prompt as a cache hit with only the final
  instruction changed (Anthropic engineering post, 2026-03-25).
- Wire check: the 5.6 model pages list `none, low, medium, high, xhigh,
  max`; pi-ai's `providers/data/openai-codex.json` maps `minimal` to `low`
  and `model-runtime.js` passes effort through unclamped, so the configured
  `minimal` filter had run at `low` since 2026-09-09 and the "Luna-low
  trial" was never a change. `none` reaches the request body as `none`.
  The filter's `maxTokens: 256` also holds reasoning tokens; a truncated
  reply parses as `ask`, an unmeasured forward path. `prompt_cache_key`
  comes from the `sessionId` option (`openai-codex-responses.js:169`);
  the classifier passed none until this change. The same id keys the
  driver's WebSocket continuation cache (`acquireWebSocket`,
  `buildCachedWebSocketRequestBody`), where a request with a different body
  clears the root's `previous_response_id` delta, so the classifier is
  pinned to SSE (cross-model review, 2026-09-18).
- System card (deploymentsafety.openai.com/gpt-5-6, 2026-07-09; GPT-Red
  section 2026-08-03): search/function-call injection defence Terra 0.946,
  Luna 0.897, Sol 0.910; direct instruction-hierarchy attack success Terra
  0.061%, Luna 0.11%; indirect agentic injection Luna 2.94%, Terra 3.32%.
  No independent benchmark scores both tiers. Non-reasoning throughput
  Luna 109 vs Terra 92.6 tok/s (Artificial Analysis); matched-effort
  time-to-first-token published for neither.
- Classifier cost bound: the TypeSafe corpus's 466k input tokens are ≈ 23
  credits on Terra and ≈ 2 on Luna per 560 sessions.
- Spend by tier (2026-09-16/17): root ≈ 75%; children Sol ≈ $29,
  Terra ≈ $54 (~16%), Luna < $1. Historical Astra estimate: 4¢/credit;
  not a verified Sol/Luna or allowance conversion. No weekly Pro limit
  is on record as having bound.
- Second-vendor options: OpenCode Go $10/month, 34 open models including
  GPT-5.6 Luna, per-model monthly caps $15–60 with 5 h = 20% and week = 50%,
  pi a listed validated client (opencode.ai/docs/go, 2026-09-18); the Terra
  roles' heavy 2-day window, ≈ $14–27 at open-model rates, would spend a
  week of one model's cap. Zen pay-per-token from $0.14/$0.28 (DeepSeek V4
  Flash). GLM and Qwen coding plans plausible but secondary-sourced; Copilot
  and Gemini ruled out on third-party-client terms. Open coders score 78–81%
  SWE-bench Verified on a secondary board, with no Terra comparison. Claude
  Code takes no non-Anthropic child without a gateway; Anthropic bans
  subscription OAuth in third-party clients
  (The Register, 2026-02-20). Only pi could host a second vendor, via
  pi-subagents' per-agent `provider/model` behind `children.mjs`'s guard.
- **Open**: after apply, per-stage latency of the Terra pairing with the
  filter's `stopReason`, filter forward rate, judge verdicts on escalations
  after a failed sandboxed attempt, cached-input tokens on the judge call,
  and whether the `openai-codex` route accepts `none` (the model page says
  yes).
  The fallback trigger and the second-vendor trigger are recorded in
  `docs/pi-implementation.md`.

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
- The instruction change keeps read-only exploration, research, and bounded
  option proposals available during planning, while reserving architecture,
  approval, and synthesis for the driver. Its source-edit trigger applies only
  after an implementation slice has settled design, exclusive ownership, and
  an objective gate; the worker then owns its test/repair loop. Relevant
  model-qualified guidance: [Astra](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra),
  [Sol](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6-sol),
  [Fable 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5),
  [Fable 5.1](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1),
  and [Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5);
  planner/worker separation: [Cursor](https://cursor.com/blog/scaling-agents),
  [Aider](https://aider.chat/2024/09/26/architect.html).

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
  vendor-documented failure that keeps the rule projected on pi.
  Dropped as unsourced: "an Astra rebase at 6h+ vs Sol's 1h"; dropped as
  irrelevant: "OpenAI gates its coordination mode to the top tier" (ultra
  runs on Sol, the top worker tier). Field reports: lilting.ch 2026-09-07 —
  Astra as orchestrator "promoted every task to itself" despite AGENTS.md and
  burned a weekly quota in half a day (the GPT-side risk baseline; no
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
  behavior).
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
  absent from the Fable 5.1 main loop on 2026-09-15 (lapsed 2026-09-12).
- Cross-model review evidence: a size-only trigger fired ~20x more often
  while its hit rate fell from ~4% to under 1%; cross-model review displaced
  the subagent pass in 68% of sessions that fired it (101 of 149, 2026-09-09,
  pre-`spec-reviewer` baseline). Survived-findings count still unmeasured.
- Initiative evidence: OpenAI's GPT-6 Astra guide documents stopping to ask
  where the user expects persistence; Anthropic documents the same for Fable
  5.1; the GPT-5.6 guide finds repeated approval wording causes approval
  requests for expected actions. Verified 2026-09-08/09 against the
  model-qualified guide URLs (the bare `latest-model` alias is mutable).
- Coverage matrix (probes 2026-09-15). Shaved on
  Claude: initiative (covered on both driver classes, moot for children —
  repeating it is the documented harm) and docs_mcp (carried by the context7
  server instructions wherever those tools exist; the researcher bodies name
  context7 themselves). Kept after the pin probe: long_running_work and
  convention_recording. Whether pi children load AGENTS.md is unstated in prompt
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
  projection (sandbox-enforced on every harness).
- Cross-model cross-check (Sol, two calls): agreed with every proposal except
  a separate Exa-fetch clause (folded into web_search); noted Astra's
  under-delegation justifies the delegation line, not the driver choice.

### (pi) Relocated from the pruned build log

`docs/pi-implementation.md` went from 930 to under 120 lines on 2026-09-15;
the two measurements still carrying a trigger moved here.

- Cost read (session `01a0848e`, 2026-09-09 05:05–05:28Z, from its own
  `usage.cost` records): 192.9k uncached input, 2.26M cache reads, 10.5k
  output, $4.71 (≈118 credits) over 23 minutes, 40 assistant turns, 10
  children, peak root context 99.9k. Every turn ran `gpt-6-astra`; the same
  trajectory on `gpt-5.6-sol` is ~$1.88, so the tier choice moves cost 2.5×
  before any harness difference does. Harnesses on the same provider differ
  only in tokens per finished task: two controlled runs on identical source
  differed 4.5× in tokens — the variable is child count (3 vs 8), not the
  harness. No context bloat: 13k → 99k with one 35k step where eight
  child reports landed at once. **Open**: the Astra-default baseline to
  measure against; compare Sol and Astra on matched completed tasks.

## 2026-09-12


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

Token shares over 2 days: main-loop output 3.6M, cache-write 9.4M,
cache-read 603M raw, all subagents 3.87M/77 runs. Raw aggregate tokens and
API-equivalent conversions do not proxy Max quota. **Open**: whether Max
metering discounts cache reads — reconcile `/usage` when a limit binds.