# Dotfiles repo — working notes for agents

## Repo conventions

Chezmoi source repo: `private_dot_claude/` → `~/.claude`, `private_dot_pi/`
→ `~/.pi`, `dot_agents/` → `~/.agents`; shared templates in
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
- Keep vendor-templated files (oh-my-tmux, ghostty, gh, 1Password) verbatim
  except for the customised lines. *Why: they stay diffable against upstream.*

- Edit source state only; verify renders with `chezmoi diff` plus
  `chezmoi cat <target>` for every harness the file renders to — `chezmoi diff`
  reports a template error after all the other diffs, where it is easy to miss,
  and a shared template is only half-checked from one harness's target.
- Nested shared templates need `includeTemplate`, not `{{ template }}`.
- Declare a subagent once in `.chezmoidata/agents.yaml`, scoped
  with `harnesses:` where it is not for every harness; a shared skill body
  lives once in `.chezmoitemplates/skills/` with a one-line stub per harness.
  The render parity test in `private_dot_pi/agent/workflow/render.test.mjs`
  (run by `npm run test:pi`, in CI) is the gate. *Why: per-harness copies and
  hand-kept tables drift from the data; a failing test catches it, prose does not.*
- Before editing a module under `private_dot_pi/agent/workflow/`, check the
  TUI module list at the top of `docs/pi-design.md`; for a listed module read
  the whole doc — its rules change only with a dated decision there.
- Leave `chezmoi apply` and 1Password signin to me; stub `onepasswordRead`
  when verifying affected templates. Resolved values belong only in applied
  private targets, never in source files, commits, or terminal output.

## Agent instructions

- Before editing an instruction source — `docs/agents-baseline.md`,
  `.chezmoitemplates/agent-instructions.md`, a consumer template
  (`private_dot_claude/CLAUDE.md.tmpl`, `private_dot_pi/agent/AGENTS.md.tmpl`),
  a subagent or skill body (`.chezmoitemplates/{subagents,skills}/`, the
  shared `.chezmoitemplates/*.md`, `private_dot_claude/skills/`,
  `.claude/skills/`), `private_dot_pi/agent/subagent-tool-description.md.tmpl`,
  `.chezmoidata/agents.yaml`, an on-demand doc (`private_dot_*/docs/`) or
  `docs/agents-audit-log.md` — read `docs/agent-authoring.md`.
  `npm run test:pi` checks that each harness projection, each rendered
  `harness.md` and this file render within the line budgets it declares.
- Agent memory holds only what this repo cannot record — session-side
  gotchas; a method belongs in the skill and a measurement in the dated
  audit log.
