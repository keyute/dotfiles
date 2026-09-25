# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`AGENTS.md` → Placement). An entry whose trigger has resolved and whose
baseline no longer serves a future sweep is deleted, not archived — git
history keeps it.

## 2026-09-25

### Claude driver → Opus 5.5; Fable 5.1 becomes escalation-only

Decision: `agents.claude.defaults.model` `claude-opus-5-5` at `high` (saved
under `modelSettings`; Claude Code ignores a top-level `effortLevel` for Opus
5.5 and would start it at `medium`; `[1m]` dropped, the 1M window is default on
Opus 4.7+ and Fable). `subagent_tiers.claude.frontier` stays Fable 5.1 so the
deny hook keeps it off children. The shared template's frontier-driver bullet
was gated whole on the driver being the frontier tier; the cross-model review
and the implementer both flagged that the ownership half (delegate
implementation slices, keep decisions and final verification in the driver,
finish a failed piece yourself) is tier-independent, so only the tier sentence
is conditional now and the pi render is unchanged; the baseline principle
is retitled Frontier driver → Driver ownership (coverage key `frontier_driver`
→ `driver_ownership`) to match. The 2026-09-23 paired-replay gate was not
run; the swap rests on:

- Anthropic, Opus 5.5 announcement (2026-09-22): "performs at the level of
  Claude Fable 5.1 on most work"; its max-effort table has Opus 5.5 ahead on
  every row (Terminal-Bench 4.0 66.4 vs 55.8, FrontierCode 54.4 vs 50.3,
  CursorBench 57.8 vs 51.8, OSWorld 81.8 vs 80.7, HLE 67.7 vs 65.6), "the gap
  … is narrower than these scores suggest" in their own use; 40% less verbose
  than Opus 5. Models overview: start with Opus 5.5, use Fable "when your
  evals on Opus 5.5 at higher effort still fall short"; Claude Code
  model-config: Fable for ambiguous root-cause and architecture work.
- [Artificial Analysis](https://artificialanalysis.ai/models/comparisons/claude-opus-5-5-vs-claude-fable-5-1)
  (max): index 58 vs 53, $5.98 vs $7.63 per task, Opus 5.5 ~1.5x output
  tokens; Fable `high` 51 vs Opus 5.5 `high` 54 (the pinned level).
- [Snorkel](https://snorkel.ai/blog/opus-5-5-vs-opus-5-vs-fable-5-1-coding-benchmark-results/)
  (2026-09-23, 24 terminal tasks): pass@1 60.7 vs 61.5, runs passed 68% vs
  49%, Fable failures dominated by premature termination. Practitioner reports
  (every.to 2026-09-22, HN 49804160): Opus 5.5 ≈ 90% of Fable at coding, PR
  review 8/14 at $15 vs 7/14 at $66; Fable kept for the hardest problems.
- Max metering (support article 2026-09-02): Fable ≤50% of the weekly pool
  and drains it "faster"; no multiplier published, API ratio 2.5x input.
- Not found: a matched-effort long-horizon comparison; SWE-bench Verified for
  either; Max drain ratio.

Reversal triggers:
- Revert the driver to Fable if spec-reviewer catches on driver-authored plans
  or adjudication rise above the 2026-09-15 baseline, or the Opus 5.5
  text-only end-of-turn (vendor watch item) recurs in the driver on
  unattended runs.
- Re-run the frontier question if Anthropic lifts the Fable weekly cap or a
  matched-effort long-horizon eval puts Fable ahead.
- Claude-side `agent-instructions-audit` after this model change, not yet run
  (the audit's `session+pin` probe runs one-shot when the pin family differs
  from the session's).

### Re-unified role matrix — one tier and one effort per role

Decision: `subagents.<role>` carries one `tier` and one `effort` serving both
harnesses (reverts the 2026-09-24 per-harness split); a tier is a capability
class each harness maps to its cheapest current model meeting it; effort is
absolute and re-checked once at the tier when its model changes. `mid` dropped
(tiers `small`/`top`/`frontier`). Claude now renders `general-purpose` (top,
nests) and `Plan` (`harnesses: [claude]`) as overrides of its built-ins.
`log-triager` retired; pi's `explorer` renamed `Explore` on both harnesses.
The Exa MCP host comes from agents.yaml data. Both harness docs now render
their role table from `subagents`, which retires this log's hand-kept
per-harness matrix; the CI render parity test
(`private_dot_pi/agent/workflow/render.test.mjs`) gates roster, stubs and pins.

[Artificial Analysis](https://artificialanalysis.ai/models/releases/comparisons/claude-opus-5-5-vs-claude-sonnet-5)
(2026-09-24): Opus 5.5 medium index 51, $1.34/task; high 54, $1.82; Sonnet 5
high 32, $1.79. [Sol medium/high](https://artificialanalysis.ai/models/comparisons/gpt-6-sol-high-vs-gpt-6-sol-medium):
index 40/43, $0.25/$0.37 per task. [CodeRabbit](https://www.coderabbit.ai/blog/opus-5-5-model-review)
compares Standard/Max pipelines, not effort levels: ordinary catches 51/80 vs
50/80, harder in-diff 8/13 vs 10/13 — medium lens reviewers are a trial, not
proven catch parity. API $ is not subscription drain.

Dispatches, last 45 days (root session files, user-run extraction):

| role | Claude | pi |
|---|---|---|
| explore-deep | 99 | 120 |
| researcher | 91 | 42 |
| implementer | 84 | 83 |
| diff-reviewer | 64 | 34 |
| spec-reviewer | 49 | 53 |
| ts-reviewer | 48 | 30 |
| Explore | 37 | 25 |
| dep-researcher | 21 | 29 |
| Plan (Claude built-in) | 12 | — |
| general-purpose | 9 | 9 |
| go-reviewer | 7 | 12 |
| shell-reviewer | 8 | 3 |
| infra-reviewer | 3 | 5 |
| python-reviewer | 0 | 1 |
| log-triager (retired) | 0 | 2 |

Reversal triggers:
- A lens review that misses a catch restores `high` for that role on both
  harnesses.
- Re-tier Claude `small` when Haiku 5.5 ships.
- Fall back to `gpt-5.6-sol` for pi `top` if implementer round-trips rise.
- **Open**: after apply, Claude's `/agents` shows `general-purpose` and `Plan`
  as user overrides and `/tasks` shows `claude-opus-5-5` for both; if the
  `Plan` override does not take, the fallback is the deny hook. Claude-side
  `agent-instructions-audit` after the model change, not yet run.

## 2026-09-23

### Fresh-session audit — Opus 5.5 / GPT-6 roster, vendor-guide check

Skill steps 1–4 and 6; step 5 pending the user-run store pipelines (below).
Claude Code 2.1.280, pi SDK 0.87.1. Cross-model cross-check on the pi bridge
(thread `ce600ac8`), run prompt-free from plan mode.

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
  reviewer trigger superseded by 2026-09-25. Haiku 4.5 has no model page.
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
  → `gpt-5.6-terra` (tier escalation, pre-GPT-6), nothing else.
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
effort plus vendor pages; per-effort figures are in the 2026-09-25 entry.
Opus 5.5: API default effort `medium`, thinking cannot be disabled, forced `tool_choice` 400s,
Claude Code ≥ 2.1.280 (installed). Pi SDK 0.87.1 (2026-09-22) is the first
catalog with the GPT-6 tiers and Opus 5.5; pinned from 0.87.0 in the same change.

- Claude top → `claude-opus-5-5`; frontier stays Fable 5.1. Opus 5.5 at max
  outscores Fable 5.1 at max on the same day at 0.4x the price, but uses ~1.5x
  the tokens per task, and the frontier/top split carries the frontier_driver
  rule and the deny-frontier-child hook. Superseded 2026-09-25: the driver
  moved to Opus 5.5 on external evidence without the paired replay (entry
  above).

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

### Implementer roster — one writer

- Decision: `implementer` is the only write-capable specialist; no second
  one. **Open**: add one only if a sweep shows implementer round-trips or
  per-call model overrides rising.

### Context floor and tier routing — transcript count

Counts only, session files modified in the prior 11 days (Claude 211, pi 675).
First-turn context = first assistant usage record per file (input + cache
write + cache read).

- First-turn median tokens. Claude root 37.6k (22k–48k, n=43), children
  12.0k–16.3k by tier. pi root 11.4k (min 8.6k, n=51), children
  4.4k–4.8k (n=312).
- pi verdict: no further meaningful saving. MCP is lazy (one `mcp` proxy;
  `addedToolNames` fired in 17 sessions for context7, 3 for Exa); the two
  remaining always-loaded items — the ≈1k-token roster in the `subagent` tool
  description and the ≈1.5k-token baseline children inherit — are deliberate.
- Claude local-only decision (harness.md): 0 invocations of any account-synced,
  Chrome, scheduling or dataviz skill in the window; skills used were
  cross-model review 10, cross-model advice 5, claude-api 1,
  agent-instructions-audit 1.
- Re-counted 2026-09-23: root 34.5k after the apply (entry above).
  **Open**: decide `run` / `claude-api` visibility.

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
- **Open**: after the guard fix, re-measure post-report re-reads of Explore
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

### Review of 49b4cff — doctrine, tiers, docs (same day)

Full audit (skill steps 1–4 and 6; step 5 skipped, the doctrine was hours
old), a density-evidence pass and a bloat sweep. Measurements below were moved
from the baseline whys into this audit record; they are the sources those
whys cite:

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
- Density evidence: the density why is supported in direction (Anthropic
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