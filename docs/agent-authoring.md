# Authoring agent instructions

Moved out of the repo-root `AGENTS.md` on 2026-09-26; `git log -p AGENTS.md`
holds each line's earlier history for the oscillation check below.

Apply the gates below to instruction sources: shared and consumer templates,
subagent and skill bodies.

## Gates — a rule earns its place only if all four hold

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
   docs (`~/.claude/docs`, `~/.pi/agent/docs`), where they expire cheaply.
4. **Not mechanically checkable**: anything a sandbox rule, hook, or linter
   can enforce goes there instead — prose fails silently, enforcement
   fails loudly.

## Placement

- Intent lives beside its projection: each bullet ends in a non-rendering
  `{{/* <principle>: <why> */}}` comment carrying the key `native_coverage`
  and the audit use (baseline folded in 2026-09-26). An intent change edits
  the bullet and its comment together; a shaved rule keeps its bullet under
  its `native_coverage` guard, so the intent survives the shave.
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
  audit like any principle. A tag encodes intent intrinsic to that
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
- A doc trigger names a question ("read X before changing tiers"), never a
  routine step — delegating, reviewing, starting a task — or the doc loads
  into every session (pi's "delegating a lookup" did, 65 sessions in 30 days).
- Implementation mechanics a harness editor needs go to `docs/pi-implementation.md`
  (pi and the bridge) or the audit log, not the deployed doc; `render.test.mjs`
  budgets each rendered on-demand doc.
- Occasional workflows → skills.

## Principles with no projected line

Intent that renders as structure rather than prose; the audit checks it here.

- **state_persistence** *(conditional)*: where a harness lacks reliable
  auto-compaction, persist plan, decisions and open threads to a durable file
  before nearing the window. *Why: a fresh session should resume with zero loss.*
- **reviewer_contract**: reviewers are read-only and share one severity and
  reporting contract (`reviewer-common.md`). *Why: comparable findings across
  languages.*
- **skill_bodies**: imperative; numbered steps only where order matters,
  otherwise goal, constraints and definition of done; never duplicate what the
  harness provides natively. *Why: step choreography degrades current models'
  output, and duplication drifts and burns instruction budget.*

## Style

- One imperative intent line plus a why; the why records the tradeoff or
  failure the rule is meant to protect, so the rule survives cases it never
  enumerated. Evidence, numbers and sources go to the audit log, not the why.
- State the constraint with its concrete trigger, not a description of the
  preferred world.
- Say what to do; reserve "never" for absolute boundaries and emphasis
  markers for almost nothing — both work only while scarce.
- Reuse the principle keys' exact terminology; synonyms obscure equivalence and
  make drift harder to detect.

## Maintenance

- After model or harness updates, run the `agent-instructions-audit` skill;
  it computes coverage fresh. Hand-run "lean passes" restart the churn.
- Before rewording an existing line, check its `git log -p` history: if it
  has oscillated, delete it or change the intent — never re-word.
- On-demand docs date each fact (a section-level date covers its bullets);
  re-verify a stale-dated fact before relying on it, since nothing checks
  expiry. Generated content (Claude's `sandbox.md`) is exempt.
- A new why cites its source in the dated audit log.
- The audit skill is Claude-side; from a pi session, flag the need for a run
  instead of attempting one.
