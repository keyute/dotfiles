# Authoring agent instructions

Moved out of the repo-root `AGENTS.md` on 2026-09-26 and cut to placement and
style on 2026-09-28; the gates for adding a line now live in `AGENTS.md`
(Harness iteration). `git log -p` on either file holds earlier history.

## Placement

- Intent lives beside its projection: each bullet ends in a non-rendering
  `{{/* <principle>: <why> */}}` comment. An intent change edits the bullet
  and its comment together. `native_coverage` in agents.yaml is only the
  per-harness list of principles the shared template skips.
- Harness-agnostic projection → `.chezmoitemplates/agent-instructions.md`.
  Every subagent loads the projection too (bar the `omit_instructions`
  roles: Explore on both harnesses, Plan on Claude), so driver-only rules sit under its one "session
  driver" bullet and read as the driver's, never the reader's.
- Subagent and skill bodies render for every harness: keep harness-specific
  nouns — tool names, agent names, instruction filenames — out of them, and take
  what varies as a parameter, as `reviewer-common.md` does with
  `instructions_file`.
- Harness-specific *intent* → a commented bullet in that harness's consumer
  template (`CLAUDE.md.tmpl` / pi's `AGENTS.md.tmpl`), adjudicated by the
  trigger-scoped review (AGENTS.md, Harness iteration) like any principle. A
  tag encodes intent intrinsic to that harness, never the harness where a
  failure was observed; only non-intent harness mechanics (doc pointers) live
  solely in the consumer template.
- Policy and model/tier data → `.chezmoidata/agents.yaml`; generate prose
  from it, never hand-write what it already encodes. The why, evidence and
  trigger behind a value go to `docs/decisions.md`.
- Environment facts → on-demand docs; give every doc pointer an explicit
  trigger ("read X before Y") — discretionary loading under-triggers.
- An on-demand doc loads whole at its trigger, so it carries only what that
  trigger's question needs, each fact at its current state. Quirk
  workarounds go there too, where they expire cheaply.
- A doc trigger names a question ("read X before changing tiers"), never a
  routine step — delegating, reviewing, starting a task — or the doc loads
  into every session (pi's "delegating a lookup" did, 65 sessions in 30 days).
- Implementation mechanics a harness editor needs go to
  `docs/pi-implementation.md` (pi and the bridge), not the deployed doc;
  `render.test.mjs` budgets each rendered on-demand doc.
- Occasional workflows → skills.

## Style

- One imperative intent line plus a why; the why records the tradeoff or
  failure the rule is meant to protect, so the rule survives cases it never
  enumerated. Evidence, numbers and sources go to `docs/decisions.md`, not
  the why.
- State the constraint with its concrete trigger, not a description of the
  preferred world.
- Say what to do; reserve "never" for absolute boundaries and emphasis
  markers for almost nothing — both work only while scarce.
- Reuse the principle keys' exact terminology; synonyms obscure equivalence and
  make drift harder to detect.
- Skill bodies are imperative, with numbered steps only where order matters,
  otherwise goal, constraints and definition of done; never duplicate what the
  harness provides natively. *Why: step choreography degrades current models'
  output, and duplication drifts and burns instruction budget.*
