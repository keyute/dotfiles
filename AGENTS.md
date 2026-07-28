# Dotfiles repo — working notes for agents

## Repo conventions

Chezmoi source repo: `private_dot_claude/` → `~/.claude`, `private_dot_codex/`
→ `~/.codex`, `dot_agents/` → `~/.agents`; shared templates in
`.chezmoitemplates/`, data in `.chezmoidata/`. `docs/`, `README.md`, and this
file are chezmoi-ignored (repo-local only).

- Edit source state only; verify renders with `chezmoi diff` plus
  `chezmoi cat <target>` — `chezmoi cat` surfaces template errors that
  `chezmoi diff` silently hides.
- Nested shared templates need `includeTemplate`, not `{{ template }}`.
- Leave `chezmoi apply` and 1Password signin to me; when a change touches a
  template using `onepasswordRead`, verify renders with the call stubbed,
  never by triggering a signin prompt.

## Authoring agent instructions

The sections below govern edits to the agent-instruction sources: the
baseline, `.chezmoitemplates/agent-instructions.md` and its consumer
templates, subagent and skill bodies. These projections load into every
future session, so hold edits to the gates below.

### Gates — a rule earns its place only if all four hold

*Why: instruction-following is a finite budget shared with the harness's
own system prompt; overspending erodes compliance across the whole set, not
just the new rule's.*

1. **Observed failure**: it fixes a diagnosed, recurring mistake — never an
   anticipated one. Diagnose first: a mechanical mistake wants enforcement,
   a one-off wants a better prompt; only a durable intent gap wants a rule.
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
- Harness-specific bullet → the consumer template
  (`private_dot_claude/CLAUDE.md.tmpl`, `private_dot_codex/AGENTS.md.tmpl`).
- Policy and model/tier data → `.chezmoidata/agents.yaml`; generate prose
  from it, never hand-write what it already encodes.
- Environment facts and decision records → on-demand docs; give every doc
  pointer an explicit trigger ("read X before Y") — discretionary loading
  under-triggers.
- Occasional workflows → skills.

### Style

- One imperative intent line plus a why; the why buys compliance.
- State the constraint with its concrete trigger, not a description of the
  preferred world.
- Say what to do; reserve "never" for absolute boundaries and emphasis
  markers for almost nothing — both work only while scarce.
- Point to a canonical file instead of paraphrasing it; inlined snippets,
  model names, and version facts rot.
- Reuse the baseline's exact terminology; synonyms obscure equivalence and
  make drift harder to detect.

### Maintenance

- After model or harness updates, run the `agent-instructions-audit` skill;
  it computes coverage fresh. Hand-run "lean passes" restart the churn.
- Before rewording an existing line, check its `git log -p` history: if it
  has oscillated, delete it or change the intent — never re-word.
- On-demand docs expire by their own annotations: give every fact there a
  last-verified date or a revisit trigger (a section-level date covers its
  bullets); the audit's doc sweep flags the ones that have fired.
  Generated content (`sandbox.md`) is exempt.
- Before a novel rule enters the baseline, and whenever a why here or in
  the baseline feels stale, run the `doctrine-refresh` skill — it re-checks
  every empirical claim in both against current practitioner consensus.
- Both maintenance skills are Claude-side; from a Codex session, flag the
  need for a run instead of attempting one.
- Expect projections to steer, not bind: guarantees belong in the
  environment (sandbox, hooks, tests); prose only biases behavior.
