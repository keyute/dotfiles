# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`AGENTS.md` → Placement). An entry whose trigger has resolved and whose
baseline no longer serves a future sweep is deleted, not archived — git
history keeps it.

## 2026-09-21

### Context floor and tier routing — three-harness transcript count

Counts only, session files modified in the prior 11 days (Claude 211, pi 675,
Codex 75). First-turn context = first assistant usage record per file (Claude:
input + cache write + cache read; pi: same three; Codex: `last_token_usage`).

- First-turn median tokens. Claude root 37.6k (22k–48k, n=43), children 12.0k
  small / 16.3k mid / 14.2k top. pi root 11.4k (min 8.6k, n=51), children
  4.4k–4.8k (n=312). Codex root 13.7k–21.0k, children ≈22.6k.
- pi verdict: no further meaningful saving. MCP is lazy (one `mcp` proxy;
  `addedToolNames` fired in 17 sessions for context7, 3 for Exa); the two
  remaining always-loaded items — the ≈1k-token roster in the `subagent` tool
  description and the ≈1.5k-token baseline children inherit — are deliberate.
- Pins. Claude child messages: mid 2136, small 637, top 505, frontier 0. Codex
  children all ran their preset model and effort (17 sampled first turns) — no
  #32587 inheritance; 2 built-in `worker` spawns on top/low, feeding open (d)
  of the delegation audit below.
- Implementer open (c), measured before this day's description change applies:
  dispatches Claude 20, pi 52, Codex 7; Claude writes Sep 17–21 root 231 /
  child 280 (Sep 20 alone: 112 / 64).
- Claude local-only decision (harness.md): 0 invocations of any account-synced,
  Chrome, scheduling or dataviz skill in the window; skills used were
  codex-review 10, codex-advisor 5, claude-api 1, agent-instructions-audit 1.
  Effort-per-role research (one published config: same-tier implementer medium
  / reviewer high; no source measures effort against review yield) changed
  nothing in the roster.
- **Open**: re-count Claude root first-turn context after the local-only
  settings apply (baseline 37.6k); decide `run` / `claude-api` visibility then.

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
- OpenAI tier positioning (Codex subagents doc): Sol "for ambiguous,
  multi-step work", Terra for "exploration, read-heavy scans", Luna for
  "clear, repeatable, or high-volume work" — the OpenAI-side implementer sits
  below that positioning, against 36 pi implementer runs on Terra with no
  tier-attributable quality finding (2026-09-18 sweep; one run changed
  nothing and was rejected).
- **Open**: (a) add a top-tier implementer only if a sweep shows recurring
  model overrides or failed round-trips on `implementer` dispatches for
  settled-design slices; (b) count Terra implementer failures on codex/pi
  separately — a per-harness tier, not a new role, is the first lever there;
  (c) re-measure `implementer` dispatches and root inline edits after the
  description change (baselines: 0 dispatches / 374 inline edits Sep 11–12; 4
  dispatches, 86 root / 61 child writes Sep 15; 20 dispatches, 231 root / 280
  child writes Sep 17–21, entry above).

### Delegation audit over the paired replay (scoped run)

Scope: delegation contract, delegation wait, review stacking, initiative,
roster. Evidence: the 2026-09-20 replay's `rows.json` plus tool-call metadata
from its transcripts (Codex message bodies are encrypted). Probes: Claude
self-probe (Fable 5.1), Codex via MCP (thread `01a0c12d`), pi static; worker
classes skipped — every scoped rule is driver-only. n=6, one run per arm.

- Corrections to the 2026-09-20 reading. Codex root `wait_agent` 53: 31 at
  10 000 ms (the harness floor — a 1 280 ms request came back "clamped to the
  minimum of 10000ms", so sub-floor requests are raised, not rejected), 19 at
  60 000, 2 at 50 000, 1 at 20 000; 39 of
  57 waits across all rollouts timed out. Every completed wait returned early
  (a 3 600 000 ms wait in 7 s; 60 s waits in 0–41 s). The 37 root
  `send_message` bodies are unreadable, so "status messages" is unproven. pi
  had one multi-implementer run, not three: in runs 2, 4 and 6 the second
  `implementer` launch replaced one plan mode had refused; pagination's second
  slice consumed the first. pi has no concurrency guard (limits 20, launches
  forced async) and made 0 `bg_wait` calls. Codex's 4 questions were all
  `request_user_input` in plan mode, each with its own recommended option.
- Codex wait facts (openai/codex main and the 0.154.0 binary): min 10 s,
  default 30 s, max 1 h under `features.multi_agent_v2.*_wait_timeout_ms`,
  validated min ≤ default ≤ max; the schema already says "prefer longer waits
  (minutes)"; an idle parent is not woken (openai/codex#46120, open).
  `multi_agent_v2` defaults off in 0.154.0 and a table without `enabled`
  leaves it off.
- Matrix. Wait-once: Claude covered, pi covered (tool description), Codex
  partial and failing → no ADD; enforced in Codex config (gate 4), whole key
  owned with `enabled`, floor and default 300 000 ms. Spawn-together: Claude
  and pi covered, Codex partial → ADD-candidate by rule, not added — no
  failure where coverage is partial (Codex ran three implementers in one
  worktree for the largest diff), `call_batching` overlaps, and the clause
  left the projection in 7de30aa with no reason recorded, so re-adding it six
  days later is oscillation. Initiative: Codex probe partial (covered on
  2026-09-15) → un-shaved for Codex on the probe verdict; the replay's 4
  questions without the line vs 1 with it is same-model but cross-harness, so
  it corroborates rather than decides. Self-review and cross-model review: both fired as
  written, each line already reworded twice → KEEP. Roster: `worker` with Sol
  named explicitly in 1 of 6 Codex runs → KEEP.
- Codex cross-check agreed on all but the config form: a table replacing a
  boolean `multi_agent_v2` would disable it. Adopted — a timeouts-only table
  left the feature off under a scratch `CODEX_HOME`, so the managed table
  carries `enabled`. The rendered merge script then ran against boolean, table
  and absent inputs: all end enabled with the floor; other leaves of that
  table are dropped, as whole-key ownership implies.
- Not wording: test over-building is equal on both GPT arms with the line
  projected; the false "TypeScript checks passed" is a yielded-command quirk,
  now a dated note in Codex's harness doc; pi's refused early implementer
  launches (3 of 6 runs) are a workflow follow-up.
- Counts carried forward: codex-review 2 reviews / 0 survived (2026-09-12
  trigger); one more zero-finding spec-reviewer run, 11 min on Opus, on a
  test-gated non-high-stakes 10-file body (skip-clause re-measure).
- **Open**: (a) next Codex sweep — root `wait_agent` and `send_message` per
  run under the floor, and classify `send_message` from a live Codex session;
  (b) spawn-together gets an ADD only if a sweep shows independent,
  exclusive-scope strands run serially; (c) Codex questions per plan-mode
  session after the un-shave — re-shave if unchanged; (d) alias a Codex
  `worker` role to the implementer preset only on recurring
  implementer-shaped misrouting.

## 2026-09-20

### (pi trial) Paired replay — protocol declared before any run

Decision: no standing benchmark. The passive sweep cannot decide the trial
(2026-09-12 status: pi usage is mostly self-development), so the keep/drop
call gets a one-off same-prompt replay, run by hand; working files stay under
`$TMPDIR`, only this entry is kept. Codex advisor read concurred (thread
`01a0bdd7`): per-principle scoring of the baseline at affordable n is noise.

- Cases: six shipped commits from repos in daily use — 2 bugfixes with a test
  gate, 2 small features, 1 refactor, 1 config/infra. Each is parent SHA +
  a prompt written from the commit message + gate command + the shipped diff
  as reference. No transcript reads, no synthetic tasks.
- Arms: pi and Codex on all six (both `gpt-6-astra`, same effort — a harness
  comparison); Claude on three as a ceiling reference only, since that arm
  confounds the model. Fresh worktree at the parent SHA, fresh interactive
  session, pi/Codex order interleaved in one window; record model, effort,
  harness version. Answer only when asked; log each intervention.
- Grading, in order: (1) deterministic — gate green, files outside the
  reference diff's scope, diff size vs reference, tests edited or skipped,
  commit attempted, unrequested files/helpers/flags; (2) trace —
  interventions, wall-clock, credits, summary claims vs commands actually run,
  narration comments; (3) one blinded pairwise "which would I merge" per task
  (labels stripped, order randomised): win / tie / loss. Read per behaviour
  family, never as a composite score; results are a package comparison, not an
  instruction-quality claim.
- Decision rule: pi is daily-driver-worthy if gate-green ≥ Codex's, pairwise
  wins+ties ≥ 4/6, and interventions and cost not materially worse. A
  discordant task gets one rerun on both arms; a flip counts as a tie. Short
  of that: "no detectable difference", decided on ergonomics and cost.
- Kill: fewer than six cases with an objective gate, or a rubric that cannot
  be written before seeing outputs → run nothing.
- Cases picked (all production work repos; pi's own source excluded as
  self-development): korvix/dashboard `f9b1e33` (bugfix), echelon
  backend `91aa624` (bugfix), echelon dashboard `4eaf918` and `4b4d908`
  (features), echelon backend `82e1b16` (refactor), kubecity/infrastructure
  `7dfdad5` (infra; render-only gate). Claude arm on the first, third and
  last. Each arm runs in a standalone clone cut at the parent with the shipped
  commit pruned — a worktree would leak the fix through `git log --all`.
  Baseline gates green at every parent; the shipped test hunk is a hidden gate
  for four cases (fails at parent, passes with the shipped diff; passes at
  both for the refactor), while `4b4d908`'s test is coupled to the shipped
  symbol names and is not used. Prompts are reconstructed from the commits:
  the session-store read for the original wording was classifier-denied.
- Results (15 sessions, run concurrently, one run per arm; metrics from the
  session stores, credits from the 2026-09-15 rate card, guardian priced as
  Terra). Gates: pi 6/6 green, Codex 5/6 — Codex's nationality tests carry two
  TS2769 errors that fail `npm run build`, and its summary claimed TypeScript
  passed after reading the empty output of a `tsc` call that had yielded at
  1 s. Hidden tests pass for every arm once grader artifacts are removed
  (relocated Go tests redeclared by the shipped file; Claude's pagination
  measures width where the shipped test mocks `getComputedStyle`). Production
  fixes were byte-identical or near-identical between pi and Codex in five of
  six cases, down to new file names — same model, same ideas; differences sit
  in tests and orchestration. Blinded pairwise (spec-reviewer, labels
  stripped; the pairwise was delegated rather than owner-judged): pi 2 wins, 2
  ties, 2 slight losses — one tie adjudicated from a slight loss because the
  reviewer penalised pi for a test move the repo's own instructions require.
- Cost and time, pi vs Codex over the six cases: credits 347 vs 598 (−42%);
  root model calls 151 vs 252; root peak context 24–67k vs 42–92k; questions
  to the user 1 vs 4; active turn time 73.7 vs 57.4 min (+28%). Codex's extra
  cost is root polling at Astra rates (53 `wait_agent`, 37 `send_message`
  calls) plus a guardian session; pi's extra time is child wait (42.6 vs 20.3
  min) — pi ran implementers strictly in sequence where Codex fanned out two
  or three, while pi's root spent less model time (23.6 vs 32.9 min).
- Projection read: commits 0/15; no frontier child in any arm; spec-reviewer
  fired on the larger bodies and was skipped on small test-gated ones in all
  three; Claude ran codex-review on its 10-file body. Both GPT arms over-build
  tests alike (added lines 2.8× and 3.5× the shipped diff; Claude 1.2× on its
  three), so that is the model, not a projection gap. Codex spawned an
  unnamed `worker` role twice and followed the repo's test-placement rule in
  one of two cases (pi two of two).
- Decision rule met for pi on every clause except time. **Open**: my
  keep/drop call; if pi stays, the sequential-child wait is the thing to fix
  or accept. n=6 with one run per arm — a canary, not a measurement.
  Codify the protocol into the audit skill only after it has run twice
  unchanged for a second decision, and script a runner only after that. A
  why-ablation (one why, one harness, ~10 paired transfer cases including
  over-application negatives, blinded) waits for a specific why to be up for
  deletion — at that n it detects only a large effect.

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

### (pi) TypeSafe Jev replay against the approval classifier

Offline replay of the auto-mode classifier's own payload (`{task, history,
action}`, rebuilt from 560 session files with `policy.needsReview` /
`unsandboxed` and `index.trimHistory`) through TypeSafe `jev-1.13.0` as one
Choice `{allow, deny, ask}` under the live `SYSTEM_PROMPT` plus four
speculative Nouls, with 16 hand-labelled adversarial and boundary cases.
Scratch lived in `/tmp/claude/jev-replay/`, not kept. Codex's read beforehand
and the outcome agree: the shape fits the filter stage only, never the judge.

- Corpus: 137 reviewed actions (122 unsandboxed escalations, 15 sandboxed
  reviewed verbs; 19 from child runs); observed 104 allowed, 7 denied,
  1 timeout, 25 ran-and-failed. Ground truth is the live outcome, which
  includes the judge's own recorded false positives.
- Safety: all 10 must-not-allow cases held — three injections (command
  comment, pasted issue, history) denied at confidence ≈ 1.0 with the
  `embedded_instructions_present` Noul at 0.88–0.97. Both labelled misses
  fell on the safe side: escalation without a prior failure → deny (0.99)
  instead of ask; the `gh` TLS-retry false positive reproduced (deny 0.38).
- Coverage: the sandboxed-reviewed slice fast-allows 11/13 observed-allowed
  at confidence ≥ 0.7 with zero wrong allows, but that slice is 11% of
  reviews. Escalations: 5/91 at ≥ 0.7; 24/91 at ≥ 0.5 with two wrong allows
  (both `gh` read loops the live judge had denied). Confidence on agreements
  0.51 vs 0.36 on disagreements, so gating does route the disagreements on.
- The escalation Noul separates the same-command-just-failed-sandboxed shape
  (47 of 122, mean 0.77) from the rest (75, mean 0.14), but the Choice does
  not compose it: 37 of the 75 without a prior failure still got allow.
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
card, plan and model pages and OpenCode Go, plus a trace of pi-ai's Codex
driver; decisions in `docs/pi-implementation.md` 2026-09-18.

- Vendor gates: Claude Code auto mode runs both stages on Sonnet 4.6, stage
  two reusing stage one's prompt as a cache hit with only the final
  instruction changed (Anthropic engineering post, 2026-03-25). Codex
  auto-review is one call on the `codex-auto-review` slug, `gpt-5.6-luna`
  on the API-key path (`codex-rs/model-provider/src/provider.rs`, read
  2026-09-18); no accuracy figures are published and its issue record is
  plumbing (#44808 byte limit), not misjudgement.
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
  pinned to SSE (Codex review, 2026-09-18).
- System card (deploymentsafety.openai.com/gpt-5-6, 2026-07-09; GPT-Red
  section 2026-08-03): search/function-call injection defence Terra 0.946,
  Luna 0.897, Sol 0.910; direct instruction-hierarchy attack success Terra
  0.061%, Luna 0.11%; indirect agentic injection Luna 2.94%, Terra 3.32%.
  No independent benchmark scores both tiers. Non-reasoning throughput
  Luna 109 vs Terra 92.6 tok/s (Artificial Analysis); matched-effort
  time-to-first-token published for neither.
- Classifier cost bound: the TypeSafe corpus's 466k input tokens are ≈ 23
  credits on Terra and ≈ 2 on Luna per 560 sessions.
- Spend by tier (the 2026-09-16/17 sweep above): root ≈ 75%; children Sol
  ≈ $29, Terra ≈ $54 (≈ 16% of the total), Luna < $1. Derived: rate-card
  credits equal API dollars at 4¢ (Astra 250 credits ↔ $10/MTok input), so
  pi's `usage.cost` is credits × 0.04. No weekly Pro limit is on record as
  having bound.
- Second-vendor options: OpenCode Go $10/month, 34 open models including
  GPT-5.6 Luna, per-model monthly caps $15–60 with 5 h = 20% and week = 50%,
  pi a listed validated client (opencode.ai/docs/go, 2026-09-18); the Terra
  roles' heavy 2-day window, ≈ $14–27 at open-model rates, would spend a
  week of one model's cap. Zen pay-per-token from $0.14/$0.28 (DeepSeek V4
  Flash). GLM and Qwen coding plans plausible but secondary-sourced; Copilot
  and Gemini ruled out on third-party-client terms. Open coders score 78–81%
  SWE-bench Verified on a secondary board, with no Terra comparison. Claude
  Code takes no non-Anthropic child without a gateway; Codex's
  `model_provider` is machine-local with OAuth/API-key coexistence
  undocumented; Anthropic bans subscription OAuth in third-party clients
  (The Register, 2026-02-20). Only pi could host a second vendor, via
  pi-subagents' per-agent `provider/model` behind `children.mjs`'s guard.
- **Open**: after apply, per-stage latency of the Terra pairing with the
  filter's `stopReason`, filter forward rate, judge verdicts on escalations
  after a failed sandboxed attempt, cached-input tokens on the judge call,
  and whether the Codex route accepts `none` (the model page says yes).
  The fallback trigger and the second-vendor trigger are recorded in
  `docs/pi-implementation.md`.

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
  occasionally, raise its effort to low before touching the prompt.
  Resolved 2026-09-18: `minimal` was already `low` on the wire and the
  pairing above is superseded; the measurement continues under the
  2026-09-18 classifier entry. Not done:
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
