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
- Keep vendor-templated files (oh-my-tmux, ghostty, gh, 1Password) verbatim
  except for the customised lines. *Why: they stay diffable against upstream.*

- Edit source state only; verify with `npm run test:pi` (inside the agent
  sandbox: `TMPDIR=/tmp/claude/x`; its fixture renders every target into a
  scratch destination with a stubbed `op` and reports template errors), plus
  `chezmoi cat <target>` where the target is readable.
- Declare a subagent or MCP server once in `.chezmoidata/agents.yaml`,
  scoped with `harnesses:` where not for every harness; a shared skill
  body lives once in `.chezmoitemplates/skills/` with a one-line stub per
  harness. *Why: copies drift from the data.*
- Code the harness spawns outside the sandbox (MCP servers, the bridge, hooks)
  treats caller-supplied paths, repos and arguments as hostile: pin its config,
  refuse sandbox-writable roots, and ship a malicious-input test.
- Before adding to `private_dot_pi/agent/workflow/`, read the module map atop
  `docs/pi-design.md` (the whole doc for a module it marks TUI).
- Leave `chezmoi apply` and 1Password signin to me. Resolved values belong
  only in applied private targets, never in source files, commits, or
  terminal output.

## Harness iteration

Changing models, roles, settings or instruction lines follows
`docs/decisions.md` Events; review runs only on those events and only over
what the event touches, never as a scheduled or whole-harness sweep.

- **One record, only if needed.** Shared values live in agents.yaml. A
  decision gets a `docs/decisions.md` row (owned code: a `docs/pi-*.md`
  entry) only if the code, a key comment or the vendor default cannot show
  its why *and* a named event would reverse it; else git history holds it.
  Edit it in the same change. A key comment says what the key does or the
  hazard that breaks it, never evidence or a date. Agent memory holds only
  session-side gotchas.
- **Rough parity by default.** Both harnesses reach roughly the same end
  state where each can, not a faithful port. Name the boundary that enforces a restriction — sandbox, policy, tool list — never
  imply one.
- **Set a vendor setting only to change its default**, to pin a value the
  harness UI persists, or because owned code reads it; a one-line comment
  beside the key names the behaviour it changes; a row only if measured.
- **A line earns its place.** An always-loaded instruction line, or a rule in
  this file, the `docs/decisions.md` header or `docs/agent-authoring.md`,
  exists only for a diagnosed, recurring failure that the harness prompt, the
  code or a check does not already prevent; when `git log -p` shows one
  oscillating, delete it or change its intent, never reword it. Read
  `docs/agent-authoring.md` before editing an instruction source.
