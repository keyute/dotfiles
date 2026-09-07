# Pi implementation working record

Last updated: 2026-09-07 evening (guard parity: applied workflow copy and
node_modules symlink, relayed policy messages, Claude-shaped transcript rows,
ask-user plugin; earlier: fourth comparison run: footer-hosted fleet rows, launch-
sourced task text, sibling rank pairing; third run: one-turn launches, Claude
Code's concurrency and nesting shape, interactive fleet panel, direct MCP
tools; earlier the same day: sandbox-parity shell approvals, forced-async
children, MCP cache key). Source implementation complete; not applied or
live-tested on the host.

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
- 2026-09-07 (second same-prompt run): sandboxed shell no longer goes to the
  classifier, matching Claude Code's `autoAllowBashIfSandboxed` and Codex's
  sandboxed exec. The earlier read-only allowlist sent 36 of 54 bash calls to
  Luna at a 17 s median (p90 = the 30 s timeout) and it denied two read-only
  commands; the run was bounded by the slowest child spending ~2 of its 5
  minutes waiting. `needsReview` keeps only remote-mutating verbs on the
  classifier (`git push`, non-read `gh`, `gh api` with method/field,
  `npm publish`, `docker push`, `curl`/`wget` upload flags, `ssh`/`scp`/
  `sftp`/`rsync`): the SRT profile cannot tell fetch from push on an allowed
  domain and `~/.config/gh` plus keychain git auth are reachable inside it.
  Obfuscation of a listed verb is an accepted residual, as with Codex's
  dangerous-command check. `/approvals ask` still prompts for every command.
  Plugin check the same day: `@gotgenes/pi-permission-system` (8.5k dl/wk) is
  deterministic rules with the same safe list, no LLM; the LLM classifiers on
  npm (`pi-auto-approval`, `pi-cruise-control`) have <50 dl/wk. Custom stays.
- 2026-09-07: subagent display is a workflow-owned widget below the editor
  (`scripts/pi-workflow/fleet.mjs`) rendering `agent › task · tokens · model`
  per running child — the Claude Code subagent-statusline row — from
  pi-subagents' documented in-process RPC (`subagents:rpc:v1` `status`,
  `data.fleet` DTO v1; renders nothing when the capability is absent).
  FleetView, the async widget and rich inline rows are off in
  `extensions/subagent/config.json`; the `Ctrl+Alt+F` inspector stays.
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
- 2026-09-07 (third same-prompt run, on the sandbox-parity source): pi 8m07s vs
  Codex 5m11s at equal or lower tokens (342k uncached / 3.5M cached / 27.7k out
  vs ~448k / 4.5M / ~30k). Time went to: 41 s before the first accepted launch
  (`action:list` turn, then a batch refused for an extra `cwd` key — the same
  misfire in every run, driven by pi-subagents' tool schema and always-appended
  safety guidance, which the custom description cannot remove); a 6m16s
  diff-reviewer child re-reading everything from a fresh context while Codex's
  forked children made zero tool calls; 14 MCP calls with zero successes (proxy
  discovery, three calls to a Claude-style `mcp__exa` name, then `fetch failed`
  on every Exa/Context7 request in the tree); three grandchildren admitted then
  denied at session_start by the broker's cap of 3. Changes: the launch hook
  drops unsupported keys instead of refusing (only workflow scripts, task lists
  and chains still throw), the tool description carries the roster generated
  from `agents.yaml` so no `list` turn is needed, `context: "fork"` is accepted
  (Codex's `fork_turns: all`), status `view: transcript` is allowed, capacity
  is 20 in `extensions/subagent/config.json` and the broker (Claude Code's
  `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` default; Codex 0.153 uses 4), and
  nesting takes Claude Code's shape: specialists are leaf roles (`nests: true`
  opts a role in, `allowNestedSubagents` follows it) and a pi-only
  `general-purpose` role — every tool, `model: inherit`, resolved to the
  parent's model in the hook — is the one that delegates, at
  `maxSubagentDepth: 2` (Claude's three layers). `forkContext` stays at the
  default full copy: the pruned mode fails the launch on any summary error.
- 2026-09-07: the fleet widget takes Claude Code's panel shape (`⏺ main` row,
  `◯` child rows, five visible, `↓ N more`, `❯` cursor) and navigation is an
  editor-owned mode: pi-tui widgets cannot take focus, so `CaretEditor` lets
  the base editor handle Down first and enters fleet mode only when the cursor
  did not move (wrapped lines, history and autocomplete keep priority — Codex
  advisor's refinement), then routes `tui.select.*` keys to a pure reducer in
  `fleet.mjs`; Enter shows the highlighted child's transcript tail (RPC
  `status {id, view: transcript}`) in a `ctx.ui.custom` overlay. The fleet DTO's
  keys are opaque, so the row maps to its run through `asyncSnapshot.runs`
  (label = agent, raw `startedAt` within 30 s, and only when exactly one run
  qualifies — same-agent siblings launched together are ambiguous); otherwise it feeds
  pi-subagents' ⌃⌥F shortcut bytes through the editor's `onExtensionShortcut`
  (legacy `ESC ^F`, CSI u under kitty), which opens the inspector without an
  agent turn but on its own first row (Codex review finding).
- 2026-09-07 (fourth same-prompt run, on f77d134): pi 5m25s at 426k uncached /
  3.5M cached / 26.4k out — Codex parity in time (5m11s–5m23s) and below it in
  tokens; Claude Code's 1m46s is a delegation choice (it ran the review itself),
  not a harness gap, and the rule for that already sits in the AGENTS.md
  projection. Launches were accepted in one turn 22 s in (one `action:list`
  turn still precedes them, ~5 s); all six Exa calls succeeded, confirming the
  `NODE_USE_ENV_PROXY` fix; the critical path was a 4m56s fresh-context
  shell-reviewer (19 turns) the root waited 157 s for. Panel changes from the
  run: the rows moved into the footer under the status line (the dock order in
  `chat-viewport.js` is fixed with the footer last, so a `belowEditor` widget
  can only sit above it) and the `⏺ main` row went — pi has no thread switching
  into a child, only the transcript peek. pi-subagents 0.66.0 never fills the
  fleet DTO's `goal` (`rpc.ts` `buildFleetStatus` passes none — worth an
  upstream issue) and reports `model` as the launch string with the thinking
  suffix plus `effort` again, so the task now comes from the launch's own
  `tool_execution_start`/`end` events keyed by `details.asyncId`, and the label
  strips provider and suffix (`gpt-5.6-terra medium`). Enter on same-agent
  siblings pairs rows to runs by rank (entries sort by `(startedAt, async id)`
  upstream) instead of giving up, and a failed inspector fallback notifies.
- 2026-09-07: Context7, Exa and Serena register direct tools
  (`agent_mcp_servers.<name>.direct_tools`, adapter `toolPrefix: "mcp"` →
  `mcp__exa_web_search_exa`), Playwright stays behind the proxy; results render
  `boxed` with three collapsed lines. pi-mcp-adapter (Nico Bailon's package,
  not Earendil's or ours) exposes only that two-value rendering knob. The
  `tool_call` hook and session-start activation admit `mcp__*` names for any
  role with `mcp`; the adapter's approval event already covers direct calls.
  Server workers get `NODE_USE_ENV_PROXY=1`: Node's global fetch ignores the
  proxy variables the sandbox injects, the leading hypothesis for run 3's
  `fetch failed` — unverified until a live call succeeds on the host.

- 2026-09-07 (session `01a07b0e`, padding task): every edit after plan approval
  was refused because the workflow code lived in the repository and was loaded
  from there, so `scripts/pi-workflow`, `private_dot_pi`, the templates,
  `agents.yaml`, `package.json` and the lockfile sat in `denyWrite` as
  self-protection, and the broker hid the reason behind one generic string.
  Claude and Codex protect only their applied homes and treat the repository as
  fair game because their live code goes through `chezmoi apply`. Pi now takes
  the same shape: the code moved to `private_dot_pi/agent/workflow/` (tests
  colocated, ignored on apply), the shims re-export
  `~/.pi/agent/workflow/index.mjs`, and `~/.pi/agent/node_modules` is a
  chezmoi symlink to the repository's `node_modules` — pi aliases its own SDK
  packages for any extension, so the symlink serves only the third-party
  imports and keeps one physical tree (a second `npm install` under `~/.pi`
  would duplicate the SDK and reopen the peer-alias problem). `denyWrite` keeps
  only the live-loaded paths (`~/.pi/agent`, `node_modules`, `~/.zshrc`), and
  the broker relays policy messages verbatim.
- 2026-09-07: transcript takes Claude Code's shape on pi's documented surface
  (`rows.mjs`): `•` rows for the `workspace_*` tools (`renderShell: "self"`,
  glyph coloured by state, Codex-style head/tail shell preview, edit `+a −b`
  and grep/find counts on the title line via the row's shared state and one
  deferred `invalidate`), `•` prefix on assistant text through the markdown
  transformer (pi-tui's list marker is a fixed `-` with a colour-only theme
  hook, so a bullet with hanging indent would need patched internals — what
  `pi-claude-code-ui` does; rejected with `pi-pretty` and `pi-tui-kit`),
  `Updated plan · approved` rows, `π <verb> for … · done …` turn entries
  from `agent_start`/`agent_settled` with a verb array in `rows.mjs`, and
  pi-mcp-adapter's own `compact` rendering with one collapsed line. Grouped
  "Read 3 files, ran 2 commands" summaries and agent-finished lines were cut
  (cross-row state; pi-subagents already notifies). Built-in renderers are
  keyed by tool name in `withBuiltInRenderers` and not exported, so
  `workspace_*` rows had been falling back to name + raw text.
  `@juicesharp/rpiv-ask-user-question` (48.8k dl/wk) replaces the hand-rolled
  `ask_user`; its answers feed the transcript entry and the classifier task.

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
- Live OAuth, foreground/background children, cancellation, the fleet widget, MCP and
  LSP remain acceptance gates. Do not treat fixture tests as full DX parity.
- See `private_dot_pi/agent/docs/harness.md.tmpl` for operator checks and limitations.

Do not apply, sign in, stage or commit. Run Claude-side agent-instructions-audit
after these model/harness changes; it is unavailable in this Codex session.
