# Agent-instructions audit log

Working state for the `agent-instructions-audit` skill: sweep measurements,
probe results, and decision baselines, dated, newest first. Repo-local and
chezmoi-ignored — sessions never load this. The on-demand harness docs carry
each fact's *current* state with a one-line dated annotation; this file
carries the numbers and open triggers behind those annotations (rule in
`AGENTS.md` → Placement). An entry whose trigger has resolved and whose
baseline no longer serves a future sweep is deleted, not archived — git
history keeps it.

## 2026-09-15

### Frontier doctrine reversed: frontier driver (all harnesses)

Reverses the 2026-09-14 consultant decision. Fable 5 (`[1m]`, stable channel
below the 5.1 floor 2.1.255) drives Claude Code; Astra drives Codex and pi;
implementation, exploration, research and review go to the worker tiers.
Shaved: the `frontier_escalation` rule, the Advisor-consult path, the
grown-session bump clause, every `inherit` tier (spec-reviewer and pi's
general-purpose now `top`), and the self-review floor's reading of arXiv
2607.21656. Enforcement added: Claude `CLAUDE_CODE_SUBAGENT_MODEL` = top plus
a PreToolUse hook denying frontier `model` overrides on `Agent`; pi
`children.mjs` rejects a frontier child (requested or inherited); Codex
`review_model` and `[agents] default_subagent_model` = Sol (defaults only —
no blocking lever exists). The Claude→Codex bridge is pinned to Sol via
`--model`. Evidence baselines (Reddit unreachable from the sandboxed harness:
Exa returns no reddit.com results and every fetch form incl. old.reddit and
`.json` is refused, Claude Code's fetch refuses the host — HN engineer
threads stood in):

- Driver choice: 0 firings of the consultant rule; the 2026-09-11/12 sweep
  already ran every edit inline in Fable sessions with `implementer` at 0.
  Anthropic's Fable 5 guide: "dispatches parallel subagents more readily",
  "use subagents frequently", async dispatch, fresh-context verifiers (line
  absent from the 5.1 page); model overview still says start with Opus 5;
  built-in Explore capped at Opus; `/code-review` hardcodes Opus bug agents.
  OpenAI: docs model-agnostic on who orchestrates; Sol `ultra` (only
  built-in coordination mode) gated to the top tier. Practitioners (HN Sept
  2026): Astra as sole driver scope-creeps on bounded work (rebase 6h+ vs Sol
  1h; robot-arm task handed back to Opus 5); fresh-context adversarial
  review endorsed at any tier; orchestrator re-reading verbose worker output
  is the reported cost sink. Aider architect/editor unchanged.
- Child-tier failures, measured: claude-code#84667 (16 unpinned children on
  Fable, 2,448 messages/18 min), #75055 (84 children, 11.6M tokens),
  #75054 (sonnet pins lost on background resume, 8/8 flipped), #85592 (env
  var overrode per-call requests at 2.1.223), #82252 (explicit fable
  override served by sonnet, child self-reported fable), #91220 (one resumed
  Fable subagent = 50.7% of a weekly pool); codex#32587 open, #33881/#33667
  reproduce on 0.144.x, #32705 catalog forces multi_agent_v2. Codex
  `SubagentStart` cannot block ("`continue: false` doesn't stop the
  subagent"). Resolution order re-verified: per-call → frontmatter (incl.
  `inherit`) → `CLAUDE_CODE_SUBAGENT_MODEL` → main model (v2.1.251+);
  `_FORCE` (2.1.257+) would erase specialist pins, left unset.
- Reviewer tier: 2607.21656 is Codex GPT-5.5 reviewing Opus 4.7 across
  vendors, single-file Python, reviewer writes the final program — authors
  generalise only to "use Claude to review Codex". 2603.12123, 2605.21537,
  2507.02778, 2603.16244 vary freshness/identity, never tier. CodeRabbit
  2026-07-24: Opus 5 x-high 55.2% vs mix 61.1% known-issue recall, weakest
  on concurrency/races/API misuse. Baseline to beat at Opus: 1 high + 3
  medium of 13 spec-reviewer runs (2026-09-12, at Fable).
- Bridge tier: Coding Agent Index Astra 67 vs Sol 65.1 at max effort, ~75%
  more per completed task, TTFT 464s vs 163s; no review-specific benchmark
  for either; the one community codex-review bridge defaults to Sol high.
- Codex advisor consult (hypotheses, adjudicated): agreed on spec-reviewer
  top, bridge Sol in FIXED_ARGS, `inherit` removal, pi gate; dropped a
  per-child SessionStart model assertion and a supervised Codex launcher.
- Cross-model review (Codex, 2 findings, both held after one round):
  wording narrowed — the child boundary is enforced on Claude (hook +
  default) and pi (gate), defaulted on Codex (no blocking lever), and a
  third-party Claude agent definition declaring `inherit` is a residual the
  hook cannot see. Fail-closed Codex spawning rejected (catalog can force
  multi_agent_v2, #32705; interactive Codex is a minor path). Survived
  findings count: 2 wording / 0 code.
- **Open** (next sweep): children's actual models vs pins (inheritance
  drift, `message.model` not self-report — covers the two residuals above);
  `implementer` dispatches (was 0);
  spec-reviewer high/medium catches at Opus vs the Fable baseline; Fable
  share of the weekly pool via `/usage`; root vs child token shares; driver
  effort as a lever (Anthropic: low-effort Fable cost-competitive with Opus —
  API pricing, unmeasured on Max). Run `doctrine-refresh` (self-review why
  changed its empirical claim) then `agent-instructions-audit` (native
  coverage against the Fable main-loop prompt) after apply.

## 2026-09-14

### Frontier doctrine decision (all harnesses) — superseded 2026-09-15

Reviewed frontier-as-orchestrator (Fable/Astra drives, farms execution to
Opus/Sol) vs frontier-as-consultant (Opus/Sol drives, frontier consulted
bounded). Decision: consultant pattern, projected as a shared
`frontier_escalation` rule; `subagent_tiers.claude` gained a `frontier` row
(the native Advisor tool verified against code docs same day). Pin probe:
`claude --model claude-fable-5-1 -p` returned 400 "version 2.1.251 or newer
is required" on the installed 2.1.236, so the pin is `claude-fable-5` with a
bump trigger on CLI update — this also supersedes harness.md's 2026-09-07
"`/model fable` resolved to Fable 5.1" note. Evidence baselines:

- Consultant side, measured: Aider architect/editor — strong architect +
  cheaper editor captures the frontier uplift at a fraction of the cost
  (R1+Sonnet 64.0% @ $13 vs o1-solo 61.7% @ $186); asymmetry: o1+Sonnet did
  NOT beat o1 solo, so frontier-solo wins when the whole task is
  frontier-grade (aider.chat 2024-09-26, 2025-01-24). Field failure:
  adjudication degrades into rubber-stamping (Amp user interview); planner
  handoffs missing executor constraints halved quality on a 40-case eval
  ("split-brain", kenashe.ai 2026-05-21).
- Orchestrator side: no head-to-head coding benchmark anywhere; converged
  anecdotal failures are context-starved workers + verification burden;
  workers inheriting frontier tier drain plans (claude-code#63693).
- Metering, measured: cache reads meter non-negligibly against Max pools —
  claude-code#91220: one resumed 16.7h subagent = 50.7% of a Max 20x weekly
  pool, 227.8M cache-read vs 72K output tokens, per-turn cost growing
  monotonically with transcript length. Fable: same shared pool, ≤50% weekly
  cap, "uses limits faster", exact weighting unpublished (support article,
  ~2026-09). Astra: ~half Sol's messages per 5h window at every plan tier
  (help.openai.com 2026-09-09). codex#35463 (fork-tree overnight drain,
  99.9% replayed bookkeeping) open and contested. Bucket caveat
  claude-code#55663. **Open**: cache-read weighting in Max metering — the
  existing check-`/usage`-when-a-limit-binds trigger stands.
- Shave: the (claude) top-model intake rule fired 0 times in 249 session
  files (10 carried the projection) — assistant-authored "top-model"/fresh-
  Fable-session suggestions grepped with user authorization. Dropped; the
  never-bump constraint survives inside the shared rule. **Open**: next
  sweep, count frontier-consult dispatches (frontier model override or
  Advisor use) to measure whether the new rule fires at all.

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
`implementer` 0 dispatches — all 374 Edits ran inline in Fable sessions
(**open**: unused lever, watch at next audit). Token shares over 2 days:
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
**Open**: if the next sweep repeats the duplication, move the rule into the
`Workflow mode:` system-prompt suffix in `workflow/index.mjs` and measure
again — the suffix is a different placement, not a demonstrated fix.

### (pi trial) Status

Not decidable through 2026-09-12: the Claude store sweep covered only a
2-day window, the Codex (14-day) and pi (~1-week) sweeps measured delegation
shape rather than trial adoption, and pi usage is still mostly pi
self-development, not an adoption signal. **Open**: revisit at the next
audit, or sooner once one harness clearly owns all interactive GPT sessions.
