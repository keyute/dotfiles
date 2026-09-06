# Pi implementation working record

Last updated: 2026-09-07 (pi-client gap, caret fix, catppuccin themes). Source
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
- pi-subagents' async runner resolves `@earendil-works/pi-client/unix`, which
  no pi package dependency provides (its vendored fallback covers only
  pi-server on pi 0.85.0 exactly); `@earendil-works/pi-client` is pinned at the
  root so background children can start. Re-check on every pi/pi-subagents bump.
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
