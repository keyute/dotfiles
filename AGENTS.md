# Dotfiles repo — working notes for agents

## Repo conventions

Chezmoi source repo: `private_dot_claude/` → `~/.claude`, `private_dot_codex/`
→ `~/.codex`, `dot_agents/` → `~/.agents`; shared templates in
`.chezmoitemplates/`, data in `.chezmoidata/`. `docs/`, `README.md`, and this
file are chezmoi-ignored (repo-local only).

- When changing a dotfile or harness integration, extend or replace its existing
  mechanism rather than layering on a parallel one. Keep one owner per setting,
  policy, or fact. Add a layer only for a concrete requirement the existing path
  cannot meet, and retire superseded code, configuration, and documentation in
  the same change. Judge the maintained and loaded surface—including generated
  configuration, startup work, and agent context—not just the diff.
  *Why: small additions can leave competing controls and recurring maintenance;
  preserve required behavior and safety while minimizing unnecessary machinery.*
- Adopt a plugin or package when it is maintained and widely used and its
  public API covers the need with at most a one-line seam (a renderer swap, a
  config knob, a frontmatter key). Own the code when the need is specific to
  this repo's policy or layout, when adoption would need a wrapper, pin or
  workaround for the coupling register, or when only a sliver of it would be
  used. Either way, record beside the decision the trigger that reverses it.
  *Why: an adopted package costs its upstream churn plus every seam held
  against it, and a widely used one has its breakage found by others first;
  owned code costs only what it does — the questionnaire came in-house once
  its seams outgrew the plugin, the todo panel left when the surface it
  mirrored vanished.*

- Edit source state only; verify renders with `chezmoi diff` plus
  `chezmoi cat <target>` for every harness the file renders to — `chezmoi cat`
  surfaces template errors that `chezmoi diff` silently hides, and a shared
  template is only half-checked from one harness's target.
- Nested shared templates need `includeTemplate`, not `{{ template }}`.
- Before editing the pi TUI (`{rows,footer,fleet,index}.mjs` or a dialog — `dialog`, `questionnaire`,
  `plan-approval` — under `private_dot_pi/agent/workflow/`) read `docs/pi-design.md`; its rules change only with a dated decision there.
- Leave `chezmoi apply` and 1Password signin to me; stub `onepasswordRead`
  when verifying affected templates. Resolved values belong only in applied
  private targets, never in source files, commits, or terminal output.

## Authoring agent instructions

Apply the gates below to instruction sources: the baseline, shared and consumer
templates, subagent and skill bodies. `npm run test:docs` enforces file budgets,
why lengths, dated annotations, audit-log pruning, and cross-file duplication.

### Gates — a rule earns its place only if all four hold

*Why: always-loaded instructions compete through contradiction, duplication,
density, and the reasoning cost every line adds on every turn; overspending
erodes compliance across the whole set, not just the new rule's.*

1. **Observed failure**: it fixes a diagnosed, recurring mistake — never an
   anticipated one. Diagnose first: a mechanical mistake wants enforcement,
   a one-off wants a better prompt; only a durable intent gap wants a rule.
   A failure the vendor documents for the model generation in use counts as
   observed when the harness prompt does not already carry the fix.
2. **Non-inferable**: agents cannot derive it at runtime from the code, the
   harness's own system prompt, or enforced policy.
3. **Durable intent**: it encodes what I want, not a workaround for a
   current model or harness quirk. Quirk workarounds go to the on-demand
   docs (`~/.claude/docs`, `~/.codex/docs`), where they expire cheaply.
4. **Not mechanically checkable**: anything a sandbox rule, hook, or linter
   can enforce goes there instead — prose fails silently, enforcement
   fails loudly.

### Placement

- Intent change → `docs/agents-baseline.md`, then reproject.
- Harness-agnostic projection → `.chezmoitemplates/agent-instructions.md`.
  Every subagent loads the projection too, so driver-only rules sit under its
  one "session driver" bullet and read as the driver's, never the reader's.
- Subagent and skill bodies render for every harness: keep harness-specific
  nouns — tool names, agent names, instruction filenames — out of them, and take
  what varies as a parameter, as `reviewer-common.md` does with
  `instructions_file`.
- Harness-specific *intent* → `docs/agents-baseline.md`, tagged `(claude)` /
  `(codex)`; its projection prose stays in the consumer template so the audit
  adjudicates it like any principle. A tag encodes intent intrinsic to that
  harness, never the harness where a failure was observed — such a failure
  still gets the full coverage matrix and projects wherever coverage is not
  native; only non-intent harness mechanics (doc pointers) live solely in the
  consumer template.
- Policy and model/tier data → `.chezmoidata/agents.yaml`; generate prose
  from it, never hand-write what it already encodes. The harness roster and
  each harness's audit paths (`agents.<name>.audit`) live there too: skills
  iterate it, never enumerate harness names.
- Environment facts and decisions → on-demand docs; give every doc
  pointer an explicit trigger ("read X before Y") — discretionary loading
  under-triggers.
- An on-demand doc loads whole at its trigger, so it carries only what that
  trigger's question needs: each fact at its current state with a dated
  annotation. Measurements, probe results and superseded history go to
  `docs/agents-audit-log.md` while they carry a live baseline or open
  trigger, and are deleted otherwise — git history keeps the rest. *Why: the
  doc's reader is a session answering one question; audit state's only
  reader is the audit skill.*
- Occasional workflows → skills.

### Style

- One imperative intent line plus a why; the why records the tradeoff or
  failure the rule is meant to protect, so the rule survives cases it never
  enumerated. Evidence, numbers and sources go to the audit log, not the why.
- State the constraint with its concrete trigger, not a description of the
  preferred world.
- Say what to do; reserve "never" for absolute boundaries and emphasis
  markers for almost nothing — both work only while scarce.
- Reuse the baseline's exact terminology; synonyms obscure equivalence and
  make drift harder to detect.

### Maintenance

- After model or harness updates, run the `agent-instructions-audit` skill;
  it computes coverage fresh. Hand-run "lean passes" restart the churn.
- Before rewording an existing line, check its `git log -p` history: if it
  has oscillated, delete it or change the intent — never re-word.
- On-demand docs expire by their own annotations (a section-level date covers
  its bullets); generated content (Claude's `sandbox.md`) is exempt.
- Before a novel rule enters the baseline, and whenever a why here or in
  the baseline feels stale, run the `doctrine-refresh` skill — it re-checks
  every empirical claim in both against current practitioner consensus.
- Both maintenance skills are Claude-side; from a Codex session, flag the
  need for a run instead of attempting one.
- Agent memory holds only what this repo cannot record — session-side
  gotchas; a method belongs in the skill and a measurement in the dated
  audit log.
