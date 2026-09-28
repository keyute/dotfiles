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
  used. Either way, record the trigger that reverses it with the decision: a
  model, role, setting or held-back package pin in `docs/decisions.md`, owned code in `docs/pi-implementation.md`
  or the coupling register.
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
- Before adding to `private_dot_pi/agent/workflow/`, read the module map atop
  `docs/pi-design.md` (the whole doc for a module it marks TUI).
- Leave `chezmoi apply` and 1Password signin to me; stub `onepasswordRead`
  when verifying affected templates. Resolved values belong only in applied
  private targets, never in source files, commits, or terminal output.

## Harness iteration

Rules for changing models, roles, settings or instructions; the record and
the owner's procedure are `docs/decisions.md`, and `npm run test:pi` holds
every mechanical check.

- **One slot per change**, as a dated trial: a pin, a role's tier or effort,
  a routing description, a harness setting, an always-loaded instruction
  line — with its `docs/decisions.md` row in the same change. Only a
  same-family successor to a released or retired model lands on vendor
  evidence alone, without a trial.
- **Dwell** for the period `docs/decisions.md` sets before judging a changed
  slot; earlier only when it is broken: rejected by the harness, withdrawn by
  the vendor, a red test, a security finding.
- **Never cite an unrun gate.** Label evidence by the kinds `docs/decisions.md`
  defines; benchmarks and API prices nominate a candidate, the after reading
  decides.
- **Children never run the frontier tier.**
- **One record.** The why, evidence and reversal trigger of a model, role,
  setting or asymmetry decision live only in its `docs/decisions.md` row; a
  trigger is an external event or a measured threshold, never a date. A
  comment beside such a key says what it does and carries no evidence, date
  or trigger; hazards and constraints stay beside the code; an instruction
  line's why stays in its template comment.
- **Review on triggers only** — a model release or retirement, a pin bump, a
  pool binding, a trial's after reading due, an observed failure — and only
  for what the trigger touches. No scheduled, post-update or whole-harness
  sweeps; unused roles and skills are judged at those reviews.
- **Parity by default.** Both harnesses get the same behaviour wherever each
  can express it; an asymmetry exists only as a `decisions.md` row naming the
  harness limit, or the owner's preference and its reversal trigger, and a
  side effect (a renamed tool, a disabled built-in) counts. Name the boundary
  that enforces a restriction — sandbox, policy, tool list — never imply one.
- **Set a vendor setting only to change its default** or to pin a value the
  harness UI persists, with a one-line comment beside the key naming the
  behaviour it changes.
- **An always-loaded instruction line** exists only for a diagnosed, recurring
  failure that the harness prompt, the code or a check does not already
  prevent; when `git log -p` shows a line oscillating, delete it or change its
  intent, never reword it. Read `docs/agent-authoring.md` before editing an
  instruction source (shared or consumer templates, subagent and skill
  bodies, on-demand docs).
- A decision goes in `docs/decisions.md`; agent memory holds only
  session-side gotchas.
