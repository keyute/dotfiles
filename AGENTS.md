# Dotfiles repo — working notes for agents

## Repo conventions

Chezmoi source repo; `docs/`, `README.md` and this file are repo-local only.

- When changing a dotfile or harness integration, extend or replace its existing
  mechanism rather than layering on a parallel one. Keep one owner per setting,
  policy, or fact. Add a layer only for a concrete requirement the existing path
  cannot meet, and retire superseded code, configuration, and documentation in
  the same change. Judge the maintained and loaded surface—including generated
  configuration, startup work, and agent context—not just the diff.
  *Why: small additions can leave competing controls and recurring maintenance.*
- Prefer the harness's own API, then first-party capability the
  subscription covers, then a plugin, then owned code; paid third-party
  services only escalate. Adopt a plugin only if maintained, widely used and
  its public API covers the need with at most a one-line seam; own it for
  this repo's policy or layout, or when adoption needs a wrapper, pin or
  coupling workaround, or uses only a sliver.
- Keep vendor-templated files (gh, 1Password) verbatim
  except for the customised lines. *Why: they stay diffable against upstream.*

- Edit source state only; verify with `npm run test:pi` (preserve the inherited
  `TMPDIR`).
- Declare a subagent or MCP server once in `.chezmoidata/agents.yaml`,
  scoped with `harnesses:` where not for every harness; a shared skill
  body lives once in `.chezmoitemplates/skills/` with a one-line stub per
  harness. *Why: copies drift from the data.*
- Code the harness spawns outside the sandbox (MCP servers, hooks)
  treats caller-supplied paths, repos and arguments as hostile: pin its config,
  refuse sandbox-writable roots, and ship a malicious-input test.
- Before adding to `private_dot_pi/private_agent/workflow/`, read the module map atop
  `docs/pi-design.md`.
- Leave `chezmoi apply` and 1Password signin to me. Resolved values belong
  only in applied private targets, never in source files, commits, or
  terminal output.

## Harness iteration

- **A model release is one line.** Replace the ID in `subagent_tiers`
  (`.chezmoidata/agents.yaml`) and run `npm run test:pi`; a pi ID the pinned
  SDK catalog lacks waits for the pi dependabot PR. No evaluation, and nothing
  else moves on a release; revert the line if work visibly gets worse.
- **Tiers follow the kind of work**: small for bounded lookups, mid for
  implementing a settled design, top for judgement (review, research,
  planning); frontier drives, and runs only the `Plan` role as a child. A role
  sets `effort` only where a miss is costly; the rest take `subagent_effort`.
  Change one because I ask or a role visibly fails, never from a benchmark or
  a usage reading. When a weekly limit binds, lower an effort one step.
- **No decision log.** A setting's why is its key comment — what the key does
  or the hazard that breaks it — and git history. Agent memory holds only
  session-side gotchas.
- **Rough parity by default.** Every harness reaches roughly the same end
  state where each can, not a faithful port. Name the boundary that enforces a restriction — sandbox, policy, tool list — never
  imply one.
- **Set a vendor setting only to change its default**, to pin a value the
  harness UI persists, or because owned code reads it.
- **Keep always-loaded text short.** An instruction line, or a rule in this
  file, exists for a failure that recurred and that the harness prompt, the
  code or a check does not already prevent. Read `docs/agent-authoring.md`
  before editing an instruction source.
