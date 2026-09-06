# Pi implementation working record

Last updated: 2026-09-06. Source implementation complete; not applied or live-auth tested.

## Decisions

- Brew installs Pi on macOS; Linux keeps its declarative npm entry. Existing root
  npm manifest/lockfile owns extension dependencies and the Pi SDK used by workers.
- OpenAI subscription OAuth only: Luna small, Terra mid, Sol default/top, Astra
  frontier escalation. Pi SDK 0.84.4 does not list Astra; do not invent an alias.
- Native host Pi and trusted extensions; model file/shell/LSP operations run in
  per-process SRT workers. MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases. Child role
  shims connect to the same live policy. Tools have `workspace_` names to prevent
  native builtins satisfying child allowlists when the policy extension fails.
- Managed zsh launch disables native tools and ambient extensions; explicitly
  loads workflow plus the existing Herdr lifecycle extension when present.
- MCP script mode and arbitrary subagent workflow/management paths are disabled;
  named foreground/background launches and lifecycle controls remain enabled.
- Serena metadata is redirected into session scratch; source remains read-only
  during planning. Narrow fixed semantic tool set; LSP runs entirely in sandbox.

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
