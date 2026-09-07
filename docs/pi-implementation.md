# Pi implementation working record

Last updated: 2026-09-07 (transcript comparison fixes: forced-async children,
local read-only command check, MCP cache key, Exa tool list). Source
implementation complete; not applied or live-tested on the host.

## Decisions

- The root npm manifest/lockfile is the only Pi install (CLI and SDK are one
  package, pinned exactly); Brew and metapac entries were dropped because they
  cannot declare versions and pi breaks extension APIs across 0.x releases.
  Upgrade as one unit: bump the pin, `npm ci`, `npm run test:pi`, apply.
- OpenAI subscription OAuth only: Luna small, Terra mid, Sol default/top, Astra
  frontier escalation. The pinned Pi SDK (see `package.json`) lists Astra; if a
  future pin drops it, report unavailable — do not invent an alias.
- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases. Tool leases
  require a single-use ticket minted at approval, bound to epoch/role/tool.
  Child sessions carry the policy epoch they were launched under (via the
  parent's environment) and are refused if it changed before they connected.
  Known bound: a launch admitted before a transition but spawned after it
  inherits the new epoch — closing that needs a per-launch hook pi-subagents
  does not expose (request upstream if it ever matters); each child write is
  still individually authorized under the current mode, so the residual is
  timing, not an unreviewed write path.
  Child role shims connect to the same live policy. Tools have `workspace_`
  names to prevent native builtins satisfying child allowlists when the policy
  extension fails.
- Security claim is scoped: effects and subprocess execution are sandboxed;
  path probes, diff generation, and output temp files stay host-side.
- Managed zsh launch runs the repo-pinned CLI in fullscreen TUI (mouse
  click-to-expand), disables native tools and ambient extensions, and loads
  workflow plus the existing Herdr lifecycle extension when present.
- pi-subagents registers unwrapped (the former registerTool Proxy was an
  undocumented composition); launch policy runs in the blocking `tool_call`
  hook (documented mutable input), bounded by the capability ceiling and
  enforced at the broker's child leases. MCP script mode and arbitrary
  subagent workflow/management paths stay disabled; `list` discovery, named
  launches and lifecycle controls are enabled.
- No LSP integration (dropped 2026-09-06; `@narumitw/pi-lsp` was deep-imported
  against internals, per-invocation server starts forfeit LSP's benefit, and
  the package is young/solo/unproven). Serena covers symbols; diagnostics via
  toolchains in `workspace_bash`. Reintroduce only on measured pain.
- pi-subagents 0.66.0 (bumped 2026-09-07) resolves `@earendil-works/pi-client/unix`
  only when the host pi is exactly 0.85.0 (`runner-aliases.ts`
  `PI0850_PEER_ALIASES`, #1944), so the root `@earendil-works/pi-client` pin
  added for 0.65.1 was removed. Re-check on every pi/pi-subagents bump: the
  child-preflight test passes without it, live background launch is the gate.
- The host copies the settings `editorPaddingX` (default 0) onto custom editors
  right after the factory runs and on settings reloads; `CaretEditor` clamps
  `setPaddingX` to ≥ 2 so the caret's padding columns survive. A `promptPrefix`
  editor option is the right upstream ask.
- Themes come from the data-only `catppuccin-pi-theme` pin, registered by path
  through the managed settings `themes` array (no `pi install`, no extension);
  the `theme` light/dark pair enables pi's terminal-followed auto mode.
- Serena metadata is redirected into session scratch; source remains read-only
  during planning. uv tool/python dirs are also redirected into scratch (they
  neighbor denied credentials), with uv's macOS cache allowed in the shared
  sandbox data.
- 2026-09-07, from the same-prompt comparison against Claude Code and Codex
  (pi 20 min vs Codex 5.5 min at equal cost): every child launch is forced
  `async` in the `tool_call` hook — pi-subagents admits one foreground launch
  per turn and FleetView shows async runs only — and the parent-facing tool
  description is the managed `subagent-tool-description.md` (upstream's tells
  the model to use `workflowScript`, which policy blocks).
- 2026-09-07: shell authorization checks locally first, as Claude Code and
  Codex do. `isReadOnlyCommand` (union of Codex's `is_safe_command` set and
  Claude Code's read-only Bash set, fail-closed on any substitution, redirect,
  grouping, quote inside a token, or unquoted glob where flags decide — the
  last two were Codex-review catches: bash reassembles `--p're=x'` and expands
  `--p*` into flags the rules never saw) allows without review; everything else
  keeps the classifier.
  Execute-mode edits inside the workspace allow after the path check. The SRT
  profile, not the list, is the security boundary. Reuse was checked:
  `@gotgenes/pi-permission-system` has the best pi-side classifier but does
  not export it; no generic npm library ships a maintained read-only list.
  Deferred hardening options: Codex-style dangerous-command denylist (forced
  `rm`, `sudo`/`env` unwrapping); a separate network-capable bash lease (the
  SRT README warns domain filtering cannot tell fetch from push on github.com).
- 2026-09-07: MCP server definitions carry only `PI_WORKFLOW_ROLE` in `env`.
  pi-mcp-adapter keys `~/.pi/agent/mcp-cache.json` on the definition including
  env, so the per-session broker socket/token made every session a cache miss
  and cost a connect/describe dance per server. The runner reads socket/token
  from the inherited process environment.
- 2026-09-07: approval requests (`authorize`/`mcp`) time out after 600 s with
  a user-facing message and announce the pending dialog; classifier replies
  fenced in ```json parse. Known residuals (Codex review): a timed-out
  approval does not cancel the queued review; tickets are not bound to the
  reviewed arguments; the confirm dialog truncates at 12,000 chars.

## Verification and remaining gates

- Automated tests cover pinned package registration, real child launch preflight,
  policy decisions, shared child capacity, revocation and runner lifecycle.
- Pi, Claude and Codex projections pass isolated `chezmoi cat` and `diff` with
  inert secret stubs. No applied credential stores were read.
- The installer and vendored plan mode are removed from source. Obsolete
  targets were removed from the machine directly (2026-09-06) instead of via
  `.chezmoiremove`, which is gone.
- Actual Unix sockets/SRT cannot run in this session (socket binding returns
  EPERM). Broker tests use an explicit memory transport; the opt-in live test is
  not evidence of a successful sandbox run until executed on the user's host.
- Live OAuth, foreground/background children, cancellation, FleetView, MCP and
  LSP remain acceptance gates. Do not treat fixture tests as full DX parity.
- See `private_dot_pi/agent/docs/harness.md.tmpl` for operator checks and limitations.

Do not apply, sign in, stage or commit. Run Claude-side agent-instructions-audit
after these model/harness changes; it is unavailable in this Codex session.
