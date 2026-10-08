# Harness decisions

Why opens with its evidence kind: measured (a reading here; its date may sit
in the why), vendor, benchmark (third-party; nominates only), preference,
forced. Revisit when: an event noticed in use, never a date or a reading
nobody takes.

## Events

A release moves a pin, never the layout: the tier set (small/top/frontier),
which tier drives, the classifier and search tiers, and each role's tier and
effort change only on their own row's event, as their own change after the
re-pin has landed, unless `npm run test:pi` forces an effort the new pin
lacks; the owner picks its substitute. A tier is added only when a role
misses at one tier, the next catches it, and a model is priced between them;
a tier nothing uses is dropped.

- **Successor or retirement.** A successor replaces its pin when the vendor
  or a benchmark rates it at least as good at no more total cost per task;
  the pool-binds reading confirms or reverts it. Confirm the model is live:
  `claude --model <id> -p 'reply OK' --output-format json` via `!`
  (sandboxed Bash has no API host), or listed in
  `node_modules/@earendil-works/pi-ai/dist/providers/data/<provider>.json`;
  else bump the SDK first, alone. Edit the tier in `subagent_tiers`; on
  Claude, an `Agent(model:<family>)` deny if the old family is left
  untiered. Rewrite
  every row whose evidence was about the old pin (on Claude, the tier row); a
  family-level why stays. A driver or projection-loading re-pin re-checks
  native_coverage as a Claude Code release does; a top or frontier re-pin
  re-checks that tier's efforts as its own change. `npm run test:pi`,
  `chezmoi diff`; re-confirm live after apply.
- **New family.** As above; then read the vendor's prompting guide for the
  pin and delete a `model:`-tagged line in
  `.chezmoitemplates/agent-instructions.md` when every pin that loads it
  (drivers, and roles without `omit_instructions`, on harnesses whose
  native_coverage does not skip it) behaves so natively or the guide warns
  against the steer. Add nothing in this pass.
- **Claude Code release** (brew, unpinned; noticed from the release notes on
  upgrade): (a) a per-call `Agent(model:…)` that slips through, or a
  native_coverage line missing from the prompt → fix that key; (b) a new
  default-on tool, setting or surface → one call: off (key comment),
  Claude-only, or port; (c) a model the notes announce → Successor or
  retirement.
- **pi or plugin bump** (the dependabot `pi` PR): a red stability pin → the
  `docs/pi-coupling.md` entry's *On red* marker (repair, or fall back and
  delete the surface). Diff the bumped pi-ai catalogs for newer ids →
  Successor. Re-read the `parity.*` rows, pi-coupling *Retire*
  conditions and `docs/pi-implementation.md` triggers the changelog touches; a renamed config path moves in the same
  PR. After apply, re-check live: subscription login, root and child model
  pins, auto approvals, cancellation, the fleet rows and peek, MCP queries.
  Then, as its own change after the bump lands, take for each owned
  module, coupling entry and plugin the changelog touches whichever of
  native, plugin or owned code leaves the least owned code and coupling at a
  roughly equal end state, deleting the superseded code, rows, pins and docs
  with it; a `docs/pi-design.md` rule is the end state, so a replacement that
  breaks one changes the rule first.
- **The pool binds** (a harness blocks a session on its weekly limit). The
  owner runs `! node scripts/agent-usage.mjs` (the stores are sandbox-denied):
  a recent re-pin whose rows cost more than its predecessor's (Claude
  role|model per dispatch, in $ or seconds; pi model|origin per call) is
  reverted first, or its row is rewritten as measured.
  Otherwise lower that driver's effort, then its tier, per its row.

## Decisions

| key | why | revisit when |
|---|---|---|
| subagent_tiers.claude.small | benchmark: AA at high 38 ($0.08/task) vs the previous small pin's 36 at low ($0.35–0.42), below it on AutomationBench tool use at every effort; Explore is ~0.4% of Claude spend | successor or retirement (Events); an observed Explore miss the previous small pin catches → a tier between small and top |
| subagent_tiers.claude.top | benchmark: AA $/task nominated it; no paired replay | successor or retirement (Events); an unattended text-only turn ends → the previous top pin |
| subagent_tiers.claude.frontier | preference: escalation-only under its 50% weekly cap | the cap is lifted → re-open the driver; successor or retirement (Events) |
| agents.claude.defaults.tier | preference: top at effort high | the Claude pool binds → lower effort, then tier |
| agents.pi.defaults.tier | preference: frontier drives while the pi pool is slack; effort high per AA Terminal-Bench (cheaper per task than lower effort) | the pi pool binds → lower effort, then tier |
| agents.pi.defaults.classifier | vendor: top tier for both stages on its system card's injection defence, judge medium; preference: filter low, the pin having no off level | an observed false allow, or false denies blocking work → re-judge; the pi pool binds → judge low, then a cheaper tier |
| agents.pi.defaults.context_window | measured: an 838,180-input-token request accepted on the frontier tier via the subscription route (2026-09-29); small and top tiers unprobed | a re-pin, or context_length_exceeded below the window → re-probe that tier at ~840k input tokens, drop it if rejected; the pi pool binds on long turns → a larger reserve |
| agents.pi.search_tier | preference: each search is one extra request on the pool, so the small tier | an observed search miss the top tier catches → top |
| setting.native_coverage | measured: covered lines are in Claude Code's driver and subagent prompts or pi's subagent-tool-description; docs_mcp in context7's server instructions (Claude); initiative is driver-only: a child cannot check back | a Claude Code release lacks a covered line → unshave it; a context7 bump → re-check docs_mcp |
| agent_mcp_servers.pi.args | preference: review and advice are recall-critical, so `--reasoning-effort high` | the pi pool binds with the bridge origin a visible share in agent-usage → medium |
| measure.role_matrix | preference: top/medium default, lookups lower, recall-critical higher; benchmark: Explore at high, where the small pin first matches the old pin; pi unmeasured | an observed Explore miss → a mid tier; Explore slower than explore-deep → medium; a lens miss a later review catches → high; a small re-pin → probe a role at small |
| parity.researcher_no_bash | forced: upstream release-note hosts are off the shared Bash allowlist, so curl there fails confusingly; WebFetch/WebSearch reach them without widening every role's Bash | the allowlist covers upstream hosts, or a fetch tool fails on them → Bash |
| subagents.infra-reviewer | preference: chart/CRD/GitOps hazards are not inferable from surrounding manifests | a manifest review where diff-reviewer's lens finds the same hazards → fold in |
| subagents.diff-reviewer | preference: one any-language reviewer; the go/python/ts/shell presets were generic checklists dispatched only by ship-check | a shipped language-specific defect the correctness lens missed → restore that preset |
| setting.pi_mcp_exposure | measured: declarations cost context7 ~1,150, exa ~460, playwright ~4,400 tokens (2026-09-30); the root defers every MCP server to tool_search as Claude does; children declare the tools their role names | the root pays the tool_search hop for one server most turns → a direct exposure for that server in mcpConfig |
| setting.workflowSizeGuideline | measured: workflows were 62.3% of top-tier units (30 days to 2026-09-28) with unguided runs of 11, 3, 8 agents → small | a workflow stops short of work it needed → unset |
| setting.explore_routing | measured: Explore:explore-deep dispatches 37:99 Claude (its 30-day transcript window), 25:120 pi → the descriptions steer lookups to Explore | an observed Explore miss on a question routed to it → revert the descriptions |
| measure.omitClaudeMd | measured: a child's first turn was 16.2k tokens with the instructions; lookup, planning and research roles need no repo conventions. explore-deep joins by preference, unmeasured | a named miss traced to missing instruction context → revert for that role; the pool binds → measure explore-deep's rows |
| instruction.cross_model_review | measured: 33 sessions to 2026-09-30, 65 of 91 findings confirmed by the driver, ~20 would have shipped a bug, ~5 also caught elsewhere | the pool binds and agent-usage shows no bridge sessions → retire the bridge and its skills; three reviews in a row with only rejected findings → narrow the trigger |
| instruction.cross_model_advice | measured: 30 calls to 2026-09-30, 4 changed a decision (each a checkable flaw), none proven worse; it conceded every pushback → flaws, not a verdict | a decision from an unverified advisor claim is later reversed → user-invoked only; three calls in a row adopting nothing → retire advise and its skill |
| instruction.scope_of_extras | measured: pi-side replay arms shipped 2.8–3.5× the tests; no reversible-change test ban yet | a shipped diff carries unrequested tests after a model release → the vendor's no-tests-for-reversible-changes line |
| measure.single_writer | measured: implementer median 17 calls per dispatch (2026-09-26); the only write-capable specialist | implementer dispatches run out of turns or deadline on bounded slices → a second write-capable specialist |
| measure.pi_second_vendor | measured: children 25% of root+child pi spend; a weaker substitute repays its saving through repairs | the pi pool binds with children ≥30% of spend → OpenCode Go for explore-deep |
| instruction.self_review | measured: 13 spec-reviewer runs, 4–5 zero-finding, every catch on a high-stakes surface → the skip and fix-scoped re-review; fresh-context review beats same-session (F1 28.6 vs 24.6, arXiv 2603.12123); repeat rounds cut precision 0.30→0.20 (2603.16244) | zero-finding runs dominate an agent-usage reading → narrow the rule |
