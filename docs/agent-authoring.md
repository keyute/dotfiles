# Authoring agent instructions

Gate for adding a line: `AGENTS.md` (Harness iteration).

## Placement

- Intent lives beside its projection: each bullet ends in a non-rendering
  `{{/* <principle>: <why> */}}` comment. An intent change edits the bullet
  and its comment together.
- A comment opens with `model:` when the line compensates a model default;
  an untagged line is an owner contract.
- Harness-agnostic projection → `.chezmoitemplates/agent-instructions.md`.
  Non-omitted workers retain shared/project policy. Driver rules live once in
  `driver-instructions.md`: Claude includes them in its projection; Pi loads
  them through workflow.json `driverInstructions`, root-only.
- Subagent and skill bodies render for every harness: keep harness-specific
  nouns — tool names, agent names, instruction filenames — out of them, and take
  what varies as a parameter.
- Harness-specific *intent* → a commented bullet in that harness's consumer
  template (`CLAUDE.md.tmpl` / pi's `AGENTS.md.tmpl`), judged on its
  `docs/decisions.md` event like any principle. A
  tag encodes intent intrinsic to that harness, never the harness where a
  failure was observed; what varies only by path (the doc pointers) takes a
  per-harness value from agents.yaml inside the shared projection.
- Policy and model/tier data → `.chezmoidata/agents.yaml`; generate prose
  from it, never hand-write what it already encodes.
- Environment facts → on-demand docs; every pointer carries an explicit
  trigger that names a question ("read X before changing tiers"), never a
  routine step — delegating, reviewing, starting a task — or the doc loads
  into every session; discretionary loading under-triggers.
- Retrieve relevant sections for unresolved questions, not whole owned docs
  for routine familiar tool use. Implementing workers still read full vendor-
  mandated harness docs/examples. Keep detailed evidence in workers; return
  essential cited contracts and uncertainty. Use native context boundaries and
  explicit output limits: cache hits or hidden UI do not evict context.
- Implementation mechanics a harness editor needs go to
  `docs/pi-implementation.md`, not the deployed doc.
- Occasional workflows → skills.

## Style

- One imperative intent line plus a why; the why records the tradeoff or
  failure the rule is meant to protect, so the rule survives cases it never
  enumerated. Evidence and numbers stay out of the why; a row only where One
  record calls for one.
- State the constraint with its concrete trigger, not a description of the
  preferred world.
- Say what to do; reserve "never" for absolute boundaries and emphasis
  markers for almost nothing — both work only while scarce.
- Skill bodies are imperative, with numbered steps only where order matters,
  otherwise goal, constraints and definition of done; never duplicate what the
  harness provides natively. *Why: step choreography degrades current models'
  output, and duplication drifts and burns instruction budget.*
