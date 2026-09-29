# Authoring agent instructions

Gate for adding a line: `AGENTS.md` (Harness iteration).

## Placement

- Intent lives beside its projection: each bullet ends in a non-rendering
  `{{/* <principle>: <why> */}}` comment. An intent change edits the bullet
  and its comment together. `native_coverage` in agents.yaml is only the
  per-harness list of principles the shared template skips.
- A comment opens with `model:` when the line compensates a model default;
  an untagged line is an owner contract.
- Harness-agnostic projection → `.chezmoitemplates/agent-instructions.md`.
  Every subagent loads the projection too (bar the `omit_instructions`
  roles in agents.yaml), so driver-only rules sit under its one "session
  driver" bullet and read as the driver's, never the reader's.
- Subagent and skill bodies render for every harness: keep harness-specific
  nouns — tool names, agent names, instruction filenames — out of them, and take
  what varies as a parameter, as `reviewer-common.md` does with
  `instructions_file`.
- Harness-specific *intent* → a commented bullet in that harness's consumer
  template (`CLAUDE.md.tmpl` / pi's `AGENTS.md.tmpl`), judged on its
  `docs/decisions.md` event like any principle. A
  tag encodes intent intrinsic to that harness, never the harness where a
  failure was observed; what varies only by path (the doc pointers) takes a
  per-harness value from agents.yaml inside the shared projection.
- Policy and model/tier data → `.chezmoidata/agents.yaml`; generate prose
  from it, never hand-write what it already encodes.
- Environment facts → on-demand docs; give every doc pointer an explicit
  trigger ("read X before Y") — discretionary loading under-triggers.
- An on-demand doc loads whole at its trigger, so it carries only what that
  trigger's question needs, each fact at its current state. Quirk
  workarounds go there too, where they expire cheaply.
- A doc trigger names a question ("read X before changing tiers"), never a
  routine step — delegating, reviewing, starting a task — or the doc loads
  into every session.
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
