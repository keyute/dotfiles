# Pi implementation working record

Last updated: 2026-09-08 (unsandboxed shell flag; earlier the same day: dot
form everywhere; earlier: 2026-09-07 evening
transcript redesign and lean pass; guard parity: applied workflow copy and
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

- 2026-09-07 (evening, transcript redesign): from a side-by-side of pi, Codex
  and Claude Code the owner asked for Claude Code's presentation of work in
  progress, Codex's composer, pi's own glyphs, and rules that stop the churn.
  `docs/pi-design.md` now holds the design language (seven rules, each with
  its why) and AGENTS.md points at it. Changes: reasoning hidden
  (`hideThinkingBlock` + empty hidden label); rows are `• title` plus one `↳`
  summary line, no body (the title-suffix state and its deferred invalidate
  went with it); Claude's fold-on-speak — `workspace_*` rows since the last
  assistant text collapse to one dim summary when the assistant speaks, ctrl+o
  unfolds (module registry keyed by toolCallId; rows record their invalidator
  on every render because the first render precedes `tool_execution_start`;
  `message_update` and the non-streaming `message_end` both close a group);
  the turn clock's label rides pi's working spinner via `setWorkingMessage`
  and left the status line; the `π` turn entry waits for live children
  (counted from `subagent:async-started/complete` — the status poll lags
  `agent_settled`) or a typed prompt, and an aborted run prints `Interrupted`
  at once; fleet rows are `π main` + `⊙ title · tokens · model` with `›` on
  the cursor row (Enter peek kept by the owner's choice; `⊙` chosen over `∘`
  as too small, `❯` kept over `>` for the same reason). Simplifications from
  the same review: one newline-JSON reader (`lines.mjs`) for broker, worker
  and codex wires; ripgrep runs the sandboxed grep (JS matcher and the
  never-used walk fallback removed); sandbox-runner keeps two test seams and
  surfaces real SRT errors; `memory-transport` gone (integration test binds a
  real socket, skips where denied); `rootTools` exported once from
  `policy.mjs`; literal prompt guidelines instead of a regex over SDK prose;
  broker child cap read from the subagent config; `stability.test.mjs` fails
  the pin bump on any undocumented import or event. Kept on purpose: the
  serena env branch in the broker (its home and generated config are
  per-session scratch paths the static MCP template cannot express), the `gh`
  read-only regex (denying `~/.config/gh` would break the one-time `gh auth
  login` all three harnesses share), the codex app-server usage read
  (annotated, outside the npm pin), per-invocation SRT workers (a pool per
  role and epoch is the follow-up).

- 2026-09-08 (dot form everywhere, from four screenshots and a Claude Code
  reference): plugin rows join the transcript's shape — pi-subagents and
  pi-mcp-adapter get a Proxy of the extension API whose `registerTool` swaps
  only `renderShell`/`renderCall`/`renderResult` on `subagent`, `mcp` and
  `mcp__*` (`index.mjs` `pluginApi`). This supersedes the "registers
  unwrapped" decision above for presentation only: that Proxy intercepted
  policy, this one never touches schema or execution, and pi has no
  renderer-override API (earendil-works/pi#3541; `pi-tool-display` does the
  same interception with its own look and declares pi ≤ 0.80). Codex advisor
  concurred and added the adapter's `details.error` (failures without
  `isError`), read as the one `details` exception. Subagent rows use `○`
  (owner's pick) and never fold; MCP rows fold ("called 2 MCP tools"). Fixes
  from the review of `84ab0e1`/`64a3e06`: clicking a folded summary restored
  one row (pi's MouseRegion flips that row's `expanded` only — the last row now
  shares its flag with the group and wakes its siblings); `(no output)` was
  counted as a line; and pi's `resetExtensionUI` on `/new`/`/resume` cleared
  the header, composer and hidden-thinking label while the once-only guard
  never re-applied them — the likely reason the screenshots showed reasoning
  lines and a plain `>` prompt. Also: shell errors preview 2+2 lines with
  `… N more lines`, a blank line under the header, one two-column inset for
  rows, `↳` lines, turn line and `❯` prompt, the fold summary dotless at the
  text column, `○ agent finished · task` completion lines from
  `subagent:async-complete` (pi-subagents notifies only failures), and the
  `π main` fleet row dropped. `stability.test.mjs` pins every source string
  these rely on. Codex review (one round) found two real defects, both fixed:
  the details-derived failure invalidated the row inside its own render (pi's
  `invalidate` rebuilds synchronously, duplicating the body — now a microtask)
  and a paused, resumable child printed as failed (the payload's resolved
  per-result `status` now leads, worst status wins). Follow-ups left alone: `ops-worker.mjs` SIGTERM force-exit
  racing the graceful drain; `lint.yml` comments naming `verify.yml`;
  `.chezmoiignore` for `memory-transport.mjs` where `.chezmoiremove` would
  delete a stale copy; workflow display-name renames vs GitHub required
  checks; repo-global `legacy-peer-deps`.

- 2026-09-08 (afternoon, standardising the day's oscillation): a git read of
  84ab0e1 → 78cd978 showed the composer shade off→on→off, its prompt padding
  2→4→2, the inset rule none→"one inset"→"glyph at the edge", and the fleet
  row losing its agent name; the owner settled each with a dated decision in
  `docs/pi-design.md`. Composer = the user box (shaded block, blank shaded row
  above and below, `❯` at column 0), with pi's working spinner in the top row
  via the documented `embedWorkingStatus` — the standalone spinner row is
  pi's, one column in with a blank line above (pi-tui `Loader` hardcodes
  both). Folds now close on anything that stays visible (subagent and other
  plugin rows, failed rows, completion and turn lines, the next run) instead
  of only on assistant text, so each contiguous run of foldable rows gets its
  own handle. Fleet rows are `○ agent › title · tokens · model` again. A
  reply that opens with a heading renders it bold on the bullet line.
  Researched and dropped: assistant text at Claude Code's text column —
  `outputPad` is 0/1 by design (pi#6168, #6757), no assistant renderer hook
  (#6747, #6876, #5834), no maintained package, so only a pi patch reaches it;
  the double blank line after hidden reasoning is pi#8154. Both recorded as
  residuals with their issue numbers in the design doc and `harness.md`.

- 2026-09-08 (later, Tab completion): `/add-dir` and `/remove-dir` carried
  `getArgumentCompletions` but pi only opened that menu on a typed letter
  matching `[a-zA-Z0-9.\-_]`, and Tab bypassed it twice over: in argument
  position `handleTabCompletion` asks for forced file completion, whose
  `force` flag is the very flag the built-in provider's slash branch is
  guarded on, and accepting an item with Tab cancels the menu with nothing to
  re-open it. So Tab offered files and policy-refused directories, and never
  opened for a path starting `~` or `/`. Fixed on the documented
  `ctx.ui.addAutocompleteProvider`: the wrapper re-issues a forced request in
  `/<cmd> <args>` position unforced, for every command (pi's own `/model`,
  `/thinking` and `/login` had the same bug), falling back to the forced path
  request when a command has no completions — never for `add-dir`/`remove-dir`,
  where the fallback would put back exactly what `rootRejection` filters out.
  It answers `shouldTriggerFileCompletion` itself, since `/cmd ` trims to a
  slash command pi refuses to force-complete, and it is idempotent because
  `addAutocompleteProvider` pushes rather than sets and `/reload` re-emits
  `session_start` without the reset that clears the stack. `CaretEditor` feeds
  the key back to the base editor after a Tab accept that lands on the
  command's space or a directory separator, which is what makes Tab walk the
  tree; the guard is deliberately not "any argument", or accepting a
  `/remove-dir` root would re-apply itself and cost an undo step. `/remove-dir`
  lost its `ctx.ui.select` picker in the same change: with the menu listing the
  added roots on an empty argument, the picker was a second mechanism for one
  job, and the flat one-shot list is the worse of the two.

- 2026-09-08 (evening, catalog review): the pi.dev gallery (~5,450 listed,
  9,328 npm packages tagged `pi-package`) was ranked by npm weekly and gallery
  monthly downloads and ~70 candidates read for documented-API use, in-host
  I/O that would bypass the SRT boundary, 0.85.x compatibility and
  maintenance, against the bar "pi's UX close to Claude Code" and the cost of
  our own code. Adopted: `@juicesharp/rpiv-todo` 2.9.0 (99k/month, the
  questionnaire's author and version line; Claude Code's task list) and
  `pi-web-search` 1.4.0 (18k/month; OpenAI's server-side `web_search` on the
  same Codex endpoint and token as model calls — `pi-web-access`, 415k/month,
  fetches in-host through third-party APIs and was rejected for that).
  `native_web_search` flipped to true for pi so the shared instructions render
  Claude's search line; `search_tier: small` renders
  `~/.pi/agent/web-search.json`. Built ourselves, because every package with
  the feature spawns or writes in the host: background bash (`tasks.mjs`;
  `run_in_background` on the SDK schema, `workspace_task` output/stop, a steer
  `pi.sendMessage` at the end, one completion line, counted as running work
  by the turn line; a mode change stops it as a lease) and `/add-dir` /
  `/remove-dir` (`Policy.addRoot/removeRoot` widen the edit check and the
  sandbox write list with an epoch bump — a removal goes through `setMode`
  and stops processes; the directory's AGENTS.md rides `before_agent_start`;
  skills need a restart with `--skill` since `/reload` would restart the
  broker). Kept custom with the evidence recorded: policy/sandbox
  (`pi-sandbox` is bash-only SRT, `pi-landstrip` a closed binary, the
  permission packages have no OS sandbox, none sandboxes MCP or children),
  transcript rows (every Claude-styled package patches pi-tui or re-wraps
  `registerTool`), footer and usage (all take `setFooter`; no programmatic
  quota read exists), fleet (pi-subagents' FleetView exists but `goal` is
  still never set in 0.66.0, verified in `rpc.ts`). Skipped with reasons:
  `pi-lens` (60k/month, in-host LSP servers; the 2026-09-06 decision stands
  and it is the candidate on measured pain), `@plannotator/pi-extension`
  (53k/month; a second plan mode with browser approval beside the broker's;
  its `external` mode is the seam if ever wanted), `pi-workspace-history`
  (peer `^0.84.4`, restores files in-host; `/rewind` is a self-build
  follow-up), `pi-context-view` (1.4k/week solo), memory packages (Claude
  Code's auto-memory is prompt plus directory, a projection change if
  wanted), the `@henryqw/pi-herdr-*` family (no overlap with the Herdr state
  extension), `pi-condense` (pi's compaction already matches auto-compact),
  queue/steer packages (pi's follow-up queue is enough), the three add-dir
  packages (context loading only; the dominant one pins `^0.85.1` and hands
  the model an `add_directory` tool). The in-progress tool bullet stays
  static by the owner's choice. Usage/quota packages read the ChatGPT backend
  or the app-server directly and take the footer; `@hk_net/pi-usage-bars`
  claims to go through pi's provider API and is the one to read if the
  app-server read ever breaks. Both `chezmoi cat` renders of the Claude and
  Codex instruction files are byte-identical before and after; only the pi
  render changes. Codex review (one round) found four real defects, all
  fixed: relative deny entries (`.env`) were rooted at cwd only, so an added
  directory's `.env` was writable — `addRoot` now re-expands them per root
  and `removeRoot` drops exactly those; the instructions file was read in the
  host outside the read policy (a symlinked `AGENTS.md` could carry a
  credential into the system prompt) — now `Policy.instructions` goes through
  `checkPath` and must resolve inside the root; a mode change revoked a
  task's lease before its controller aborted, so a lost worker could report
  `failed` instead of `stopped` — `setMode` now stops tasks first; and a
  refused instructions read left the root added without an epoch bump — the
  add rolls back.

- 2026-09-08 (night, unsandboxed shell): `workspace_bash` takes Claude Code's
  `dangerouslyDisableSandbox` flag, superseding the 2026-09-06 "no fallback
  to unsandboxed execution" line in `harness.md`. The owner's Claude Code
  settings leave `allowUnsandboxedCommands` at its default (true) beside
  `autoAllowBashIfSandboxed` and `defaultMode: plan`, and the Claude Code
  docs (sandboxing, permission-modes) route an unsandboxed retry through the
  regular permission flow in every mode — a prompt in manual, the classifier
  in auto, plan mode included since v2.1.212 — never the sandboxed
  auto-allow. Pi mirrors that: the flag makes the verdict `review` in every
  mode (classifier under `auto`, dialog under `ask`), read-only roles are
  refused (the profile is their only enforcement), and the owner rejected
  auto-escalating "proven read-only" commands: what blocks a read-only
  command inside the sandbox is the boundary itself (a denied credential
  path, a non-allowlisted host, a privileged socket), which a read-only proof
  does not cover. Mechanism: the ticket minted at approval carries
  `sandbox: false`, the lease answers `profile: null`, and the runner spawns
  the ops worker without SRT under the host environment minus `PI_WORKFLOW_*`
  (the broker token must not reach the shell) and without the lease env
  (`TMPDIR` scratch and the proxy flag are sandbox artifacts); stop, terminal
  proof and background tasks are unchanged. Codex review (one round) found
  one real defect, fixed in the worker for both paths: a command that
  backgrounds work with its stdio redirected (`cmd </dev/null >/dev/null &`)
  let the shell exit and the exec resolve while the child lived on in the
  shell's process group, so the lease proved termination over a process it no
  longer covered — confined by SRT before, a free host process on the new
  path; `exec` now terminates the command's group once the shell exits, before
  it reports (`run_in_background` is the supported way to keep a process). A
  descendant the group kill cannot reach — one that left the group (`setsid`,
  double fork) or one another user owns (`sudo`, a setuid binary; the kill
  fails with EPERM and the exec now fails loudly with the reason instead of
  swallowing it, Codex's second-round finding) — stays the accepted residual
  in both paths: the terminal proof covers the leased worker's group and the
  command's group, nothing that escapes them, and an approved unsandboxed
  command that escalates privilege is the user's call at the dialog. The
  predicate is keyed on
  `tool === "bash"` (planning-review finding): `authorize` forwards every
  tool's args and the schemas admit extra properties, so a flagged
  `workspace_read` would otherwise have minted an unsandboxed file worker
  without review. The row title carries `· unsandboxed` so a
  classifier-approved escalation stays visible; `!` commands stay sandboxed.
  The null-profile lease runs for real only in the opt-in live test.
  Ship-check the same night (Codex pass) closed two gaps the path exposed: a
  worker that receives the runner's SIGTERM now SIGKILLs its live command
  groups at once — the runner KILLs the worker's own group one second after
  TERM, before the abort's TERM→KILL on the command's separate group could
  finish, so a TERM-ignoring command outlived a lease the runner then proved
  terminated — and an unsandboxed request whose serialized action exceeds the
  12k characters the confirm dialog shows is refused instead of prompting on
  a prefix. `exec` also runs one termination per child (abort starts it, the
  close handler awaits it) and the footer reuses the runner's
  `hostEnvironment` for its own subprocess env.

- 2026-09-08 (night, from two screenshots and the follow-ups): four changes.
  (1) The gap under a fold summary was pi's assistant component, not the fold:
  a folded row costs no lines (`Text("")` renders `[]` and a `renderShell:
  "self"` component with no content returns `[]`), while each hidden reasoning
  run leaves the `Spacer(1)` that component adds from raw content
  (earendil-works/pi#8154) — six blanks under one summary. `blankReasoning`
  (`rows.mjs`, wired to `message_end`) blanks the thinking text on the settled
  message, gated on `message.api` being an OpenAI Responses one: that replay
  sends `JSON.parse(block.thinkingSignature)` and never the text, and the
  signature holds the whole reasoning item including the provider's summary,
  so neither the model's context nor the session file loses anything; the
  Anthropic replay sends the text with its signature and rejects a modified
  block. Blocks are mutated in place and the same object returned, so pi's
  in-place replacement is a no-op and the stream's signature backfill keeps
  its references. (2) The working spinner left the composer for its own line
  directly above it: `embedWorkingStatus: false`, pi's own row off through
  `setWorkingVisible(false)`, and a `Loader` subclass at column 0 (dropping
  pi-tui's hardcoded one-column pad and leading blank) handed to `setWidget`
  at `placement: "aboveEditor"` from the footer's `attach`, which already
  re-applies surfaces on every session start. (3) `@juicesharp/rpiv-todo`
  removed — manifest, lockfile, the `jiti` import, `rootTools`, the row title
  and summary branches, three pins and rule 10's panel. Research behind it:
  Claude Code v2.1.233 (2026-08-14) disabled `TodoWrite` by default on its
  newest models and Codex CLI v0.152.0 (PR #41744, 2026-08-31) made
  `update_plan` opt-in, so the panel's own reference was gone; 2026 SWE-bench
  work finding plans helpful was weighed and overruled by the owner.
  (4) Sent user messages carry the composer's `❯` through the markdown
  transformer, in the box's own colour (an inner colour's reset would end the
  box's for the rest of the line). New pins cover Loader's two hardcodings,
  the widget dock order and its leading spacer, the assistant component's
  reasoning spacer, the message_end ordering and in-place replacement, and
  both providers' reasoning replay. Codex review (one round) found two real
  defects, both verified against pi's source and handled: `transformMessages`
  (called from `openai-responses-shared.js:88`) keeps a signed thinking block
  only where provider, api and model id all match, forwards the reasoning as
  plain text otherwise, and drops a block whose text is empty — so blanking
  costs those summaries after a model change, only the model id being variable
  under the managed roster. Accepted and recorded in rule 2 with its own pin
  rather than fixed, since the opaque item does not survive the change either; and an independent working row no
  longer clears when pi shows its own indicator (`showStatusIndicator` used to
  drop the embedded one), so it now stands down on the documented compaction
  events. pi's auto-retry countdown has no documented event and stays a
  recorded residual.

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
