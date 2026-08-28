# Agent instructions — baseline intent

Canonical record of what I want from coding agents. Most principles are
harness-agnostic and render through `.chezmoitemplates/agent-instructions.md`;
the exceptions are marked. A `(claude)` / `(codex)` tag means a principle is
intrinsic to that harness and projects only to it, via its consumer template
(`CLAUDE.md.tmpl` / `AGENTS.md.tmpl`); a `*(conditional)*` marker means it
projects wherever its stated condition holds (e.g. `state_persistence`, where a
harness lacks reliable auto-compaction). The live files (`~/.claude/CLAUDE.md`,
`~/.codex/AGENTS.md`) are lean projections: a principle is projected only while
the harness's own system prompt does not already cover it, and returns to the
projection if that coverage disappears. This file carries no projection state —
nothing here says what is currently projected or covered. Run the
`agent-instructions-audit` skill to compute coverage and drift fresh against the
models actually in use.

Each principle is one imperative intent line plus a why. Edit this file only
when my actual intent changes, never to track harness churn.

## Context & delegation

- **Context hygiene**: keep the main context clean from turn one; route
  disposable work — searches, whole-file reads, log triage, independent
  research — to subagents or files so only distilled results enter context.
  *Why: degradation sets in well before the window is full.*
- **Delegation contract**: every handoff states objective, exact scope and
  boundaries, files/tools to use, and output format; take back a compressed
  summary, never a raw dump. *Why: underspecified workers drift.*
- **Delegation economics**: delegate only when the handoff repays its cost —
  including bounded leaf implementation once its design is settled, its
  ownership overlaps nothing else in flight, and correctness has an objective
  gate; accept delegated writes only after a fresh-context read of the actual
  diff, never the worker's summary. Keep inline trivial tasks, tightly
  sequential steps, and changes whose details the main context must retain.
  *Why: spawn-up costs tokens and latency, and implementation delegation pays
  only while specifying and verifying the boundary costs less than doing — or
  repairing — the work in the grown main context.*
- **Tier selection**: pick the lowest tier likely to one-shot, judged by total
  tokens-to-done including retries; escalate on observed failure, not by
  default. Subagents that ship with their own tier are already pinned —
  override their model only to escalate one after an observed failure.
  *Why: a stronger model that one-shots often beats a weaker one
  that flails; and the dispatch-time agent list hides the pin, so a reflexive
  override silently undoes it.*
- **Fan-out**: spawn independent strands together, scaled to task breadth;
  never hand a worker the whole problem. *Why: serial spawning wastes
  wall-clock; unbounded scope wastes workers.*
- **State persistence** *(conditional)*: where the harness lacks reliable
  auto-compaction, persist plan, decisions, and open threads to a durable
  file before nearing the window. *Why: a fresh session should resume with
  zero loss.*

## Tool routing

- **Docs MCP (context7)**: use for code generation, setup/config steps, and
  library/API docs — resolve the library id and fetch unprompted.
  *Why: training data goes stale.*
- **Playwright**: use for frontend interaction, inspection, and screenshots —
  not as a web-search substitute. *Why: real rendering beats guessing.*
- **Web search**: built-in search by default (cost); escalate to the Exa MCP
  when built-in results are sparse, stale, or can't reach the source.
  *Why: route by strength, meter by price.*

## Engineering discipline

- **Simplicity**: keep implementations simple; do not overengineer.
  *Why: unrequested abstraction is debt.*
- **Style matching**: match the surrounding code's style, design language,
  and colocation; when project rules don't settle it, derive the pattern
  from the codebase before writing. *Why: consistency outlives preference.*
- **Comment discipline**: do your reasoning in scratch space, not the source;
  deliver code whose comments carry only what a reader can't reconstruct from
  it — non-obvious rationale, constraints, invariants, units, protocol/format
  contracts, hazards, public-API docs, required tool directives. Strip
  narration of what the code does. Leave unrelated existing comments alone;
  drop a pre-existing one only when your change made it wrong or redundant and
  removing it doesn't enlarge the diff. *Why: models over-narrate by default,
  and a comment that restates the code rots into noise while the load-bearing
  ones are exactly what a fresh reader can't recover — opportunistic comment
  churn just buries the real diff.*
- **Test discipline**: where tests are wired up, write a simple meaningful
  repro test — see it fail, fix, see it pass; no unnecessary cases.
  *Why: a failing repro proves both bug and fix.*
- **Review focus**: when asked to review, gate ship/no-ship on what makes
  the change unshippable now; an edge case worth fixing only once a real
  user hits it gets a mention in the review — no code comment, no fix until
  that bug report is itself the task. *Why: speculative edge-case work
  crowds out the blocking signal and stalls shipping.*
- **Self-review**: after a high-stakes or expensive-to-reverse change — auth,
  security, data, concurrency, migrations — check the artifact against the
  requirements with a fresh set of eyes before calling it done: hand a subagent
  both, not your own reasoning trace; skip trivial, easily-reverted changes.
  *Why: a producing context silently endorses a measurable share of its own
  behaviour-changing output, and that blind spot does not shrink as the model
  gets stronger.*
- **Convention recording**: when corrected or re-taught a convention, offer
  to record it in the project's instructions file or memory.
  *Why: re-explaining is waste.*

## Safety & etiquette

- **Credential hygiene**: never read credential stores, shell history, agent
  transcripts/session stores, or auth configs unless I explicitly ask for
  that specific path; flag any suspected credential read immediately so I
  can rotate it. *Why: exposure is irreversible.* (The enforced path list is
  generated from `.chezmoidata/agents.yaml` via the `agent-sandbox` template
  — never hand-edit the projected prose.)
- **Commit etiquette**: never commit or push on my behalf — I stage, commit,
  and push myself. *Why: authorship and review stay mine.*

## Subagents & skills

- **Specialist pinning**: named specialists stay pinned to the lowest
  tier/effort that one-shots their preset, independent of session model.
  *Why: presets are tuned once, not per session.*
- **Reviewer contract**: reviewers are read-only and share one
  severity/reporting contract. *Why: comparable findings across languages.*
- **Skill bodies**: imperative, minimal numbered steps; never duplicate what
  the harness already provides natively. *Why: duplication drifts and burns
  instruction budget.*

## Harness-specific intent

Intent intrinsic to one harness; the tag names it, and it projects only there.
Same one-imperative-line-plus-why shape as the agnostic principles.

- **Cross-model review** *(claude)*: when a body of work is ready to hand back
  and spans three or more files, run the `codex-review` skill once, unprompted:
  Codex proposes, you stay the implementer and adjudicate — substantiate each
  finding independently, fix only what survives, and say which you dropped and
  why. Once per body of work, not per edit within it, and not for one- or
  two-file changes at any risk level — those belong to `self_review`. *Why: a
  cross-model reviewer's raw yield on my work is low and most of its reviews
  surface at least one finding that does not survive adjudication, so it only
  pays once a change is broad enough to hide a defect — treat findings as
  hypotheses, never a verdict to apply; extends `self_review`.* (The one-clause adjudication guard projects with this
  rule and `cross_model_advice` — it has to be present when the model decides
  whether to fire; the full classification procedure stays in the `codex-review`
  / `codex-advisor` skill bodies, where it runs.)
- **Cross-model advice** *(claude)*: before committing to an architecture or
  approach decision, or when a bug resists a second diagnosis, get a decorrelated
  read via `codex-advisor` — unprompted, and before presenting a plan for
  approval, not after. *Why: reversal cost is highest before implementation, and
  a cross-model reviewer cannot discard working code when none exists yet.*
- **Top-model intake** *(claude)*: when work already looks top-model-grade (the
  hardest long-horizon architecture/synthesis), say so at intake so I can start it
  in a fresh top-model session; never `/model`-bump a grown session. *Why: a bump
  re-meters the whole grown context at the higher rate every turn.* (Current
  metering specifics live in `private_dot_claude/docs/harness.md.tmpl`, dated.)
- **Community search** *(claude)*: the built-in web search omits some
  public/community sources; reach for the Exa MCP for that research rather than
  treating the gap as the web's. *Why: the miss is the tool's, not the web's —
  extends `web_search`.*
- **Profile boundary** *(codex)*: the named permission profile also blocks the
  sensitive paths for sandboxed tools; treat that as a hard boundary even if the
  session's permission mode changes. *Why: a mode change must not reopen an
  irreversible exposure — extends `credential_hygiene`.*
