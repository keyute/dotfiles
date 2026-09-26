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
  *Why: small additions can leave competing controls and recurring maintenance.*
- Adopt a plugin or package when it is maintained and widely used and its
  public API covers the need with at most a one-line seam (a renderer swap, a
  config knob, a frontmatter key). Own the code when the need is specific to
  this repo's policy or layout, when adoption would need a wrapper, pin or
  workaround for the coupling register, or when only a sliver of it would be
  used. Either way, record beside the decision the trigger that reverses it.
  A dependency pin bump lands as its own change, so its cost stays measurable.
- Keep vendor-templated files (oh-my-tmux, ghostty, gh, 1Password) verbatim
  except for the customised lines. *Why: they stay diffable against upstream.*

- Edit source state only; verify with `chezmoi diff` (it reports template
  errors last, easy to miss) plus `chezmoi cat <target>` for every harness the
  file renders to. Nested shared templates need `includeTemplate`.
- Declare a subagent once in `.chezmoidata/agents.yaml`, scoped
  with `harnesses:` where it is not for every harness; a shared skill body
  lives once in `.chezmoitemplates/skills/` with a one-line stub per harness.
  Every shared key (role flags, `agent_sandbox` values) is consumed by each
  harness it applies to, or scoped. The parity test in
  `private_dot_pi/agent/workflow/render.test.mjs` (`npm run test:pi`, CI) is
  the gate. *Why: copies drift from the data; a failing test catches it.*
- Code the harness spawns outside the sandbox (MCP servers, the bridge, hooks)
  treats caller-supplied paths, repos and arguments as hostile: pin its config,
  refuse sandbox-writable roots, and ship a malicious-input test.
- Each module under `private_dot_pi/agent/workflow/` has the one
  responsibility its line in the module map atop `docs/pi-design.md` states; a
  new concern gets its own module or joins the one whose line names it. For a
  module marked TUI read the whole doc — its rules change only with a dated
  decision there.
- Leave `chezmoi apply` and 1Password signin to me; stub `onepasswordRead`
  when verifying affected templates. Resolved values belong only in applied
  private targets, never in source files, commits, or terminal output.

## Agent instructions

- Before editing an instruction source — `.chezmoitemplates/agent-instructions.md`,
  a consumer template (`private_dot_claude/CLAUDE.md.tmpl`,
  `private_dot_pi/agent/AGENTS.md.tmpl`), a subagent or skill body (`.chezmoitemplates/{subagents,skills}/`, the
  shared `.chezmoitemplates/*.md`, `private_dot_claude/skills/`,
  `.claude/skills/`), `private_dot_pi/agent/subagent-tool-description.md.tmpl`,
  `.chezmoidata/agents.yaml`, an on-demand doc (`private_dot_*/docs/`) or
  `docs/agents-audit-log.md` — read `docs/agent-authoring.md`.
  `npm run test:pi` checks that each projection, each rendered on-demand doc,
  the audit log and this file stay within the line budgets it declares.
- Judge a tier, effort or workflow change by total subscription cost per
  completed task (turns, cache reads, repairs), measured with
  `scripts/agent-usage.mjs`; benchmarks and API prices are inputs, not
  verdicts. After moving a tier pin or the driver tier, run the audit skill's
  session+pin probe for the new model before changing instruction text.
- A harness review starts from the latest dated audit-log entry and covers
  only what changed since; prefer a pi session for broad read-only sweeps.
- Agent memory holds only what this repo cannot record — session-side
  gotchas; a method belongs in the skill and a measurement in the dated
  audit log.
