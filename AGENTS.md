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
  used. Either way, record the trigger that reverses it (One record, below).
  A dependency pin bump lands as its own change, so its cost stays measurable.
- Keep vendor-templated files (oh-my-tmux, ghostty, gh, 1Password) verbatim
  except for the customised lines. *Why: they stay diffable against upstream.*

- Edit source state only; verify with `npm run test:pi` (inside the agent
  sandbox: `TMPDIR=/tmp/claude/x`; its fixture renders every target into a
  scratch destination with a stubbed `op` and reports template errors), plus
  `chezmoi cat <target>` where the target is readable. Nested shared templates
  need `includeTemplate`.
- Declare a subagent once in `.chezmoidata/agents.yaml`, scoped
  with `harnesses:` where it is not for every harness; a shared skill body
  lives once in `.chezmoitemplates/skills/` with a one-line stub per harness.
  A shared key (role flags, `agent_sandbox` values) is rendered or
  test-enforced on each harness it applies to; where it cannot be, a parity
  row names why. The parity test in
  `private_dot_pi/agent/workflow/render.test.mjs` (`npm run test:pi`, CI) is
  the gate. *Why: copies drift from the data; a failing test catches it.*
- Code the harness spawns outside the sandbox (MCP servers, the bridge, hooks)
  treats caller-supplied paths, repos and arguments as hostile: pin its config,
  refuse sandbox-writable roots, and ship a malicious-input test.
- Before adding to `private_dot_pi/agent/workflow/`, read the module map atop
  `docs/pi-design.md` (the whole doc for a module it marks TUI).
- Leave `chezmoi apply` and 1Password signin to me; stub `onepasswordRead`
  when verifying affected templates. Resolved values belong only in applied
  private targets, never in source files, commits, or terminal output.

## Harness iteration

For changing models, roles, settings or instruction lines. The record is
`docs/decisions.md` (its Events section is the procedure); `npm run test:pi`
holds every mechanical check.

- **Children never run the frontier tier.**
- **One record.** Values live in agents.yaml. A model, role, setting or
  asymmetry's why and reversal event live only in its `docs/decisions.md`
  row, edited in the same change; owned code's design, seams and triggers live in
  `docs/pi-design.md`, `docs/pi-implementation.md` and `docs/pi-coupling.md`. A comment beside a key says what it does, never
  evidence or a date; a hazard comment may name the condition that breaks it.
  Agent memory holds only session-side gotchas.
- **Review on triggers only**: the events `docs/decisions.md` names, and only
  what the event touches. No scheduled or whole-harness sweeps.
- **Parity by default.** Both harnesses get the same behaviour wherever each
  can express it; an asymmetry (a side effect counts) exists only as a row
  naming the harness limit or the owner's preference. Name the boundary that
  enforces a restriction — sandbox, policy, tool list — never imply one.
- **Set a vendor setting only to change its default**, to pin a value the
  harness UI persists, or because owned code reads it; a one-line comment
  beside the key names the behaviour it changes. A cosmetic setting needs no
  row.
- **A line earns its place.** An always-loaded instruction line, or a rule in
  this file, the `docs/decisions.md` header or `docs/agent-authoring.md`,
  exists only for a diagnosed, recurring failure that the harness prompt, the
  code or a check does not already prevent; when `git log -p` shows one
  oscillating, delete it or change its intent, never reword it. Read
  `docs/agent-authoring.md` before editing an instruction source.
