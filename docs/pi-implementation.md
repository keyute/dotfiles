# Pi implementation working record

Last updated: 2026-09-10 (fold extent derived from ordered facts, failed rows and
visible entries as separators; earlier the same day: plan renders as markdown in
its row, painted mode and approval on the status line; earlier the same day:
`/add-dir` completions climb past dead levels;
earlier: 2026-09-09 compact subagent-notice row, `/add-dir` as-you-type
completion and `..`; earlier the same day: Tab offers only declared candidates,
harness.md trigger; earlier the same day: Tab scope, fold caret, questionnaire notes; earlier
the same day: classifier evidence and stages; earlier: 2026-09-08
unsandboxed shell flag; earlier the same day: dot form everywhere; earlier: 2026-09-07 evening
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

- 2026-09-09 (classifier evidence and stages): a smoke test's read-only `gh`
  failed inside the sandbox and its `dangerouslyDisableSandbox` retry was
  refused. The sandbox half is not pi's: `gh` is a Go binary, Go's TLS
  verifier calls Security.framework, and SRT's seatbelt allows the
  `com.apple.trustd.agent` mach service only under
  `enableWeakerNetworkIsolation` (SRT 0.0.75, `macos-sandbox-utils.js`), so
  every `gh` HTTPS call fails with `x509: OSStatus -26276` — reproduced in a
  Claude Code session with the same profile, where `curl` and Node fetch
  succeed; the Claude Code docs list it under "Go-based CLIs fail TLS
  verification on macOS" (anthropics/claude-code#23416, #29533, #34876) and
  the flag is documented as an exfiltration vector. Codex's own seatbelt
  allows trustd when network is on. Not fixed here: the profile stands. The
  refusal half was the classifier: it was handed the user's messages and the
  one action, so it could not see that the same command had just failed
  sandboxed, and its prompt made deny the conformant answer. Reference
  designs (vendor docs and source, same day): Claude Code's auto-mode
  classifier is a prompted general model (Sonnet 5, user cannot pick it) in
  two stages — a single-token allow/block filter, then chain-of-thought only
  on a flag over the same cached prompt (Anthropic reports false positives
  8.5% → 0.4%) — fed user messages, the tool-call history, CLAUDE.md and
  environment slots with tool outputs stripped, denying on any classifier
  error and falling back to prompts after 3 consecutive or 20 total blocks;
  Codex gates deterministically (exec-policy rules, known-safe and dangerous
  lists, approval policy), a sandboxed failure becomes the human prompt
  "command failed; retry without sandbox?" with the model's one-sentence
  `justification`, and the opt-in Guardian reviewer (`codex-auto-review`,
  off by default) reviews only requests already needing approval. Pi's
  deterministic tiers were already in that shape (hard refusals, silent
  sandboxed allows, `needsReview` verbs, unsandboxed always reviewed); the
  gap was evidence and stage. Now each process keeps its last 20 shell
  commands (`command` cut to 2,000 chars, `sandboxed`, `exitCode`; never
  output — both vendors keep the reviewer output-blind), recorded at the
  `exec` operation for foreground, background and `!` runs alike, sent
  with every bash authorization and shape-checked in the broker, and the
  classifier message is `{ task, history, action }` with a prompt line naming
  a retry after a sandboxed failure as the flag's intended use. Codex's
  `justification` was not adopted: it is the model's claim, history is
  evidence. The classifier itself takes Anthropic's shape:
  `classifier_filter` (Luna, minimal effort — OpenAI's own "routing,
  classification, extraction" tier) answers every reviewed action and a
  verdict other than allow is re-judged by `classifier_judge` (Terra,
  medium — "work that requires sound judgment") on the same prompt; tier
  names do not map across vendors, so the choice rests on positioning plus
  the two observed, stage-shaped failures (2026-09-07: 17 s median with p90
  at the timeout; two read-only denials). Revisit trigger: the next
  same-prompt run records per-stage latency, how many actions reached the
  judge, and the judge's verdict on escalations that followed a failed
  sandboxed attempt; if the filter still forwards read-only escalations more
  than occasionally, raise its effort to low before touching the prompt.
  The recording wrapper is exported (`recordingExec`) and unit-tested, since
  neither the fixture nor the live test reaches `sandboxTool`'s worker.
  Codex review (one round): a filter failure re-judged rather than prompted
  was rejected — an allow still comes only from a parsed verdict, and a judge
  failure still prompts; the unbounded command text (twenty heredocs could
  pass the broker's 128 KiB line cap and fail valid calls) and the unrecorded
  background and `!` paths were real and fixed. Its second round showed a
  character cap does not bound the line (JSON escaping multiplies control
  characters), so an authorization now carries the newest records whose
  serialized size fits a 16 KiB budget (`trimHistory`).
  Follow-ups, not done: denials return "Action not approved" with no
  rationale and there is no fallback to prompting after repeated blocks;
  new network hosts are never reviewed (Claude Code classifies them); no
  per-rule allow/ask list; whether `codex-auto-review` is reachable on the
  subscription endpoint is unprobed.

- 2026-09-09 (from four owner reports on the live TUI): six changes.
  (1) Tab opened a file menu in ordinary prose. Not a regression: pi's own
  `shouldTriggerFileCompletion` says yes to everything but a half-typed slash
  command, and `editor.js` treats a missing hook as yes too, so the wrapper
  added for `/add-dir` had only ever widened the argument case. It now answers
  that gate itself and Tab is scoped to a command's arguments; only the forced
  path consults it, so `@path` and the command-name menu are untouched.
  (2) The working row takes a trailing blank instead of `Loader`'s leading one,
  standing it off the composer.
  (3) The fold handle carries `▸`/`▾` in the dot column and undims when open;
  the `ctrl+o to expand` hints went with the owner's "dont need the ctrl+o
  hint", which also removed a real defect — they rendered without their key,
  since pi's `keyText` reads a module global that falls back to the pi-tui
  bindings and those do not define `app.tools.expand`. The caret was chosen on
  the research: both reference CLIs mark state with only a flipping label
  (Claude Code `Read 31 lines (ctrl+o to expand)`, Codex CLI v0.149.0+
  `Ran N commands · ctrl+t to view transcript`) and their users report the
  confusion that predicts; NN/g's 2020 accordion-icon study is the one measured
  result and it favours the caret; WCAG 1.4.1 and rule 9 ruled out background
  or brightening as the sole carrier. Recorded residual: pi's own
  `Tool output: expanded` line comes from `setToolsExpanded` pushing a Spacer
  and Text onto its chat container, which no documented surface reaches and
  which is not exposed to extensions at all — so it stays, and the caret
  carries the state.
  (4) ctrl+o was one-way: the flag change ran `if (!group.open) toggleFold(…)`,
  so a second press updated `expandedAt` and left the group open, and only a
  click collapsed it. The flag is now authoritative
  (`if (group.open !== toolsExpanded)`); a group clicked open against it
  follows it again at the next press. The test that asserted "ctrl+o again
  while open expands bodies only; the group stays open" encoded the defect and
  was rewritten with it.
  (5) The edit/write `+N −N` counts take the theme's `success`/`error` pair
  (pi defines no diff-specific keys; all four catppuccin flavours define these).
  Only that summary splits its colouring — every other `↳` line keeps its
  single muted wrapper, whose reset would otherwise end the colour for the rest
  of the line.
  (6) `ask_user_question` was registered, permitted and unused: the owner had
  to type an answer to a question the model asked in prose. Wiring is correct
  (`rootTools`, the `tool_execution_end` guard, the stability and integration
  pins all match the plugin's own `ask-user-question.ts`). A `question_form`
  rule was drafted for the baseline and then withdrawn on the cross-model
  review: the plugin registers `promptSnippet` and `promptGuidelines`
  ("Use ask_user_question whenever the user's request is underspecified and you
  cannot proceed without concrete decisions") and pi's `buildSystemPrompt`
  injects a selected tool's guidelines, so the guidance was already in the
  prompt and the miss is a one-off despite it — failing the baseline's
  observed-recurring and non-inferable gates. The first rationale claimed pi
  carried no equivalent; that was checked against this repository only, never
  against the plugin. If it recurs, the lever is the plugin's own
  `guidance.promptSnippet`/`promptGuidelines` config, not an always-loaded
  rule. Reading the result was also lossy: `QuestionAnswer.notes`
  and `QuestionnaireResult.globalNote` were dropped, and an answer that was
  only a note (`answer: null`, no `selected`) was filtered out entirely, so a
  decision written rather than picked reached neither `userTask` nor the
  transcript. Both are carried now.
  Not applied or live-tested on the host; `npm run test:pi` is green (212 pass,
  0 fail).

- 2026-09-09 (later, one owner report on Tab): "every command i mid-type and
  press tab the autosuggestions pop out". The 09-08 wrapper fell back to the
  forced path request for a command with no `getArgumentCompletions`, and pi's
  `applyCompletion` appends a space when it accepts a command name
  (`pi-tui/dist/autocomplete.js`), so accepting `/new` left `/new `, the walk's
  replay read that as an argument position and forced a path request, and the
  fallback answered it with the working directory. Typing `/new ` and pressing
  Tab reached the same place with no accept at all, so the fix is the fallback,
  not the replay predicate: an unforced ask now returns the command's own
  candidates or null, and null is the answer. The replay is left alone — it is
  inert where nothing triggers, since `editor.js` returns from Tab without
  inserting a character. The `filtered` parameter went with the fallback it
  existed to suppress, and `completions.test.mjs` lost the case that asserted
  `notes.md` for an unfiltered command: it encoded the removed behaviour.
  Codex's cross-model read reproduced the same path and found the no-accept
  entry point; three of its recommendations were dropped — an
  `["add-dir", "remove-dir"]` allowlist (it would take working completions away
  from pi's own `/model`, `/thinking` and `/login`, and is a command roster to
  keep), restricting the replay to `/add-dir` (no behavioural change), and
  restoring `/remove-dir`'s `ctx.ui.select` picker (the 09-08 entry above
  records that removal as deliberate: one job, one mechanism). Accepted cost,
  Codex's own strongest counter: ~40 lines stay coupled to pi's undocumented
  `force` and cancel behaviour for one command, pinned by
  `stability.test.mjs`. Regression added at both entry points; the caret case
  fails on the pre-fix wrapper with the directory listing it produced.
  Also: pi's `AGENTS.md` told the agent to read `docs/harness.md` "before
  changing models, launching subagents, or troubleshooting …" and the owner saw
  it read every session. Nothing injects the doc — the pointer's trigger was
  simply routine work. Subagent launching moved into the troubleshooting list
  and "changing models" narrowed to "changing model tiers", the decision the
  doc's pricing tables actually serve.
  Not applied or live-tested on the host; `npm run test:pi` is green (214 pass,
  0 fail).

- 2026-09-09 (later, from a screenshot and three `/add-dir` reports): the
  2026-09-08 Proxy above now also intercepts `registerMessageRenderer`, on the
  same terms — presentation only, message content untouched. pi-subagents drew
  its control notice as a twelve-line box holding a run UUID, a `Facts:` line
  and four literal `subagent({ action: … })` calls; that text is the model's
  instructions and stays in the message's `content`, while the chat gets the
  completion line's shape (`rows.mjs` `noticeLine`). Ours is composed over the
  plugin's (`ours(…) ?? theirs(…)`) and is a total shape guard that never
  throws: `??` does not reach the fallback on a throw, and pi's own catch
  (`custom-message.js`) would then draw its default box holding the whole
  notice. Registering ours after `subagents(styled)` would also work today —
  both land in this extension's one `messageRenderers` map and `Map.set` is
  last-write-wins — but the Proxy keeps the plugin's renderer as the fallback
  and does not depend on who registers last.
  `/add-dir` also completes as you type past a separator: pi opens the menu
  while typing on `[A-Za-z0-9.\-_]` only, so the command's space, `/` and `~`
  left it closed, and `CaretEditor` makes the same unforced request
  (`tryTriggerAutocomplete`, TS-private and pinned) behind the wrapper's own
  gate, skipped while a menu is open because pi's `updateAutocomplete` has
  already re-asked for the inserted character. `addableDirs` offers `..`, so
  the walk goes up as well as down; `rootRejection` polices it for free. The
  third report — Tab while mid-typing a command name — needed no change:
  `handleTabCompletion` routes a slash line with no space to
  `handleSlashCommandCompletion`, an unforced request, ahead of the forced
  branch the wrapper gates; `caret.test.mjs` already covered it.
  Codex advisor (`01a0835a-3018-7ed2-abe1-73cfab54cdb4`) agreed on both hooks
  and supplied the throw case and the open-menu guard; it also argued
  `super.handleInput("\t")` is the worse trigger — the editor still treats it
  as forced, so it consults `shouldTriggerFileCompletion`, skips debounce and
  auto-applies a lone suggestion, and a synthesized `"\t"` only matches a user
  who has not rebound `tui.input.tab`.
  Review round (Codex `01a08369-d6ab-7223-ad60-5081c12cac7d` plus a fresh-eyes
  pass) found three real defects, all fixed: the trigger matched the raw input
  chunk, so a terminal negotiating kitty CSI-u or modifyOtherKeys — where a
  printable arrives as an escape sequence pi decodes (`decodePrintableKey`) —
  never opened the menu at all; the gate did not carry pi's own
  `isSlashMenuAllowed` (`cursorLine === 0`), so `/add-dir ~` typed on a later
  line of a multiline message opened a directory menu for a line that cannot
  run, and `commandArgument` now carries that rule for the Tab path too; and
  the row repeated itself on the notice it exists for, since
  `buildControlEvent`'s default idle signal is
  `"<agent> needs attention (no observed activity for Ns)"` — the row now drops
  the state phrase and the wrapping brackets as well as the name. Also taken:
  `Object.hasOwn` for the renderer lookup, since the key is a plugin's string.
  The re-review round caught the fix's own defect: a forward cursor delta is not
  an insertion — pressing Right across the `/` in `/add-dir ~/` advanced the
  cursor exactly as typing it does and opened the menu — so the trigger now
  requires the line to have grown by that one character, which also excludes
  history recall replacing the whole line.
  Two more owner reports the same day, both fixed: `..` was offered under a
  named directory, where it only undoes the step that got there, and is now
  offered only while the head is still all `../`; and the accept replay pressed
  Tab again, which `editor.js` applies outright when the next level holds a
  single candidate (`options.force && options.explicitTab && items.length === 1`),
  so one keypress descended two levels — the replay now makes the unforced
  request a typed character makes, and the level the accept reached is shown
  rather than walked into. The user's own Tab still completes a lone candidate.
  Left as a follow-up: `handlePaste` cancels the menu and nothing re-opens it,
  so a pasted path into `/add-dir` completes only after a further keystroke.
  Not applied or live-tested on the host; `npm run test:pi` is green
  (231 pass, 7 skipped, 0 fail).

- 2026-09-09 (screenshot pass, live session `01a0848e`): three rendering
  changes and one prompt change. (1) The status line's branch counts take the
  theme's success/error pair through a `paintCounts` exported from `rows.mjs`.
  They had been joined into the branch segment's own text and so inherited its
  accent, while the transcript's `↳ +12 −4` had taken the pair since `1b75013`
  the same day; one fact now has one encoding on both surfaces. The painter keys
  on the `+`, since the surfaces spell the minus differently (`resultSummary`'s
  `−` against `git --shortstat`'s `-`). (2) `workspace_task` left the fold set: it
  folded on its `workspace_` prefix while `WORDS` had no word for it, so
  `summarise()` returned "" and the handle drew a caret with an empty label.
  Adding the word was rejected — a background task is running work under design
  rule 4. (3) The plan row takes the tool's own `Plan approval` label; `Updated
  plan` is Codex's `update_plan` phrase. (4) Plan mode's system-prompt suffix
  said only what was forbidden ("Investigate only; …"), and the owner's report
  was that pi "required more steering in my input prompt to get it to present
  the plan" where Claude Code does the checks, asks the questions and presents
  the plan. It now carries the behaviour too: research to the point of a plan
  unprompted, delegate the independent exploration, ask with `ask_user_question`
  where different readings would lead to materially different work, then submit
  the plan. It sits at the injection point rather than in the always-loaded projection,
  where it would be dead text in execute mode, and is gated on the root in plan
  mode: the branch's own condition is `state.readonly`, which `policy.mjs` also
  returns for every read-only role in execute mode, and a child has neither
  `submit_plan` nor `ask_user_question`. `npm run test:pi` is
  green (233 pass, 7 skipped, 0 fail); `fleet.test.mjs`'s poll assertion flakes
  under full-suite load and passes alone. Not applied on the host.
- 2026-09-09 (plan-mode plugin re-adjudication): `@narumitw/pi-plan-mode`
  (4.5k dl/wk, MIT, actively pushed), `@janvitos/pi-plan-build` (819 dl/wk) and
  pi's own bundled `examples/extensions/plan-mode/` all gate at the plugin's
  tool layer — they block `edit`/`write` while the mode is on. Ours is a broker
  policy mode (`policy.mjs`) governing the tool list, the inherited role scope,
  child sessions and MCP approvals together, and `/plan` revokes running
  children and sandbox processes. A plugin sees none of that, so it would
  double-govern rather than replace, at the price of a third-party 0.x pin
  (design rule 7) and its own surfaces (rules 2, 9, 10). The 2026-09-07
  rejection stands, now for a stated reason. Claude Code's documented contract
  (code.claude.com/docs/en/permission-modes) is matched on mechanics; the gap
  was the behaviour above, and it sits at our own injection point, so no plugin
  would have supplied it.
- 2026-09-09 (cost read, session `01a0848e`, 05:05–05:28Z, from its own
  `usage.cost` records): 192.9k uncached input, 2.26M cache reads, 10.5k output,
  $4.71 (≈118 credits) over 23 minutes, 40 assistant turns, 10 children, peak
  root context 99.9k. Every turn ran `gpt-6-astra`; the same trajectory at the
  `agents.yaml` default of `gpt-5.6-sol` is ~$1.88, so the tier choice moves
  cost 2.5× before any harness difference does. Pi and Codex share the provider
  and the endpoint, so a harness can differ only in tokens spent per finished
  task: controlled run 4 was 0.87× Codex at time parity, run 5 3.9× at more than
  twice the wall clock, on identical source text — the variable is child count
  (3 vs 8), not the harness. No context bloat: 13k → 99k, with one 35k step
  where eight child reports landed at once, which is what fresh-context
  delegation buys. Of 23 Codex sessions that day ~20 were `codex_exec` (the
  review and advisor skills) and four interactive, all under five minutes:
  Codex is the reviewer now, pi and Claude Code the drivers.
- 2026-09-09 (two frictions, recorded not fixed): `subagent {action:"list"}`
  still fired twice in that session although the roster is rendered into the
  tool description — the run-3 change reduced the tax, upstream's appended
  guidance keeps it, and answering `list` from the hook waits for it to recur.
  `task test` was launched three times in 30 s (sandboxed, sandboxed, then
  `dangerouslyDisableSandbox: true`) because the suite needs a live Postgres:
  the escalation path worked as designed, and the waste belongs to the target
  repo's own AGENTS.md rather than to this one.

- 2026-09-10 (two screenshots, collapsed and expanded): fold extent is derived,
  not maintained. `rows.mjs` replaces `{current, byId -> mutable group}` with an
  ordered `timeline` of facts — `{kind:"tool", id, key, outcome}` and
  `{kind:"boundary", id}` — plus a `revision`-cached derivation; a run is a
  maximal stretch of `success` rows, all outcomes settled, with a separator on
  its right, and under two rows it is not materialised at all. `views` holds
  open/expandedAt keyed by the run's right-hand boundary (`failed:<id>` or `bN`),
  the one part fixed when it seals, so ctrl+o and click state survive
  re-derivation; `refold` diffs membership before and after a fact and wakes only
  the rows whose group changed, deriving fresh before any invalidate because pi
  rebuilds a row synchronously. Two defects drove it: four of six
  `pi.appendEntry` sites never closed the group (`workflow-task`, both
  `workflow-note`s, `workflow-answers` — `footer.mjs` and `fleet.mjs` did), and a
  failed row stayed a counted member of the header that force-rendered it, which
  `rows.test.mjs:339` had pinned. `appendVisible` now carries the boundary with
  the entry at all six sites and `stability.test.mjs` fails any other route to
  `pi.appendEntry`. A visible custom message closes the group through
  `message_end` (`displays`), gated on a truthy `display` to match pi's own draw
  test. That covers the notices a steered turn delivers and not the ones pi
  appends outside the agent stream: `_appendCustomMessage` emits to
  `_eventListeners` only and `_emitExtensionEvent` handles agent-stream types
  alone, so a goal-mission notice (`triggerTurn: false`) still draws inside a
  group — the residual now recorded in rule 2, left rather than closed at
  `pi.sendMessage`, which would fire early for the deferred append and buy a
  rule 7 coupling on pi's routing. Rejected on the way: dropping the
  failed row from its group and closing, which Codex and a trace both showed
  wrong under a parallel batch — pi emits every `tool_execution_start` in
  call order before executing (`agent-loop.js` `executeToolCallsParallel`), so
  rows started after the failure remained members of the group above it and
  rendered hidden under a header sitting above the separator. Codex proposed
  transactional splitting instead, then changed to this model when shown the
  recurrence history; splitting was declined as the hardest possible mutation
  (partitioning a live group while preserving view state under synchronous
  invalidation) against a mechanism that had already failed three times. Two
  defects came back from the review round and were fixed: a pending row reset the
  run instead of holding it, so the rows after it sealed and the group then grew
  a row and moved its handle when the pending one landed; and a `settleAll` on
  turn end, written for an abort that leaves rows pending, was removed outright —
  `emitToolExecutionEnd` runs before the executor's `if (signal?.aborted) break`
  and the parallel path emits an aborted end of its own, so nothing is ever left
  pending, and the `success` it wrote would have let `settleFold`'s own guard
  discard a real failure and fold it as a member. Tests: 254 total, 247 pass,
  7 skipped, 0 fail — two rewritten (`rows.test.mjs` 187, 339), one amended (90),
  one widened to two rows (139), and eight added, including ctrl+o both ways
  across the two groups a failed row splits apart, a failure at either end of a
  batch, the pending-row hold, and the `pi.appendEntry` source guard.
  Follow-ups left alone: `folds.timeline`, `folds.invalidate` and `folds.views`
  all grow for the session's life, as `folds.invalidate` already did; and each
  fact costs a walk of the timeline in `derive` plus a member-map copy in
  `refold`, so a session is O(n²) in facts where the old model was O(1) per
  event — irrelevant at a few thousand rows, worth revisiting if it is not.

- 2026-09-10 (owner report on `/add-dir ../`): `addableDirs` climbs on its own.
  It answered one level at a time, so a cwd at the bottom of a single-child
  chain got a menu whose only entry was a further `../`, once per level. The
  loop keeps going while every candidate at a level is `..` or the directory
  containing the cwd, and stops on the first level holding an unrelated one. An
  ancestor of cwd counts as the way back out rather than an offer, since
  `rootRejection` refuses only roots *inside* cwd: the alternative rule — stop
  at the first level with anything addable — therefore stops one level short, on
  a menu offering the directory just left, and was rejected for it. Its one
  advantage, that nothing ever leaves the menu, buys back only roots that
  swallow the cwd, typed deliberately if at all. `..` being on offer bounds the
  climb: it means the level above is one the menu would navigate to, which the
  filesystem root and home's ancestors never are, so the head strictly ascends
  and the loop is bounded by path depth. Only with nothing typed after the last
  separator — a typed name filters the level it was typed under. Not applied or
  live-tested on the host; `npm run test:pi` is green (237 pass, 7 skipped,
  0 fail).

- 2026-09-10 (owner report on the plan and the status line): two rendering
  changes. (1) `submit_plan` stopped passing the plan as `confirm`'s second
  argument. pi's `confirm` is a convenience over `showExtensionSelector`: it
  concatenates title and message and hands the result to
  `ExtensionSelectorComponent`, which draws the whole string as one
  `Text(theme.fg("accent", theme.bold(title)), 1, 0)` — bold accent, no markdown,
  and the component is a plain `Container`, so nothing scrolls. `planRenderers`
  now renders the plan as `Markdown` under its own row while the decision is open
  and the dialog carries only `/execute`'s wording, so the two approval paths ask
  the same question. The body retires on the row's own `isPartial`: pi initialises
  it true and clears it only in `updateResult`, which re-runs the call slot, so
  the flag already means "a result exists" — `glyph()` has read it that way all
  along. A first pass reinvented this as a `state.settled` flag set from
  `renderResult` with a queued `invalidate`, by analogy to `state.failed`; the
  analogy does not hold, because `state.failed` exists only to cover a case pi's
  `isError` genuinely misses, and the review that caught it is why the microtask,
  the re-entrancy guard and an extra rebuild are all gone. The window opens at
  `executionStarted`, after a first pass used `argsComplete`. That was wrong three
  ways: `setArgsComplete` fires at `message_end` for every call in the batch, so a
  plan queued behind another drew its body before its dialog, and an abort that
  broke the batch before reaching it (`executeToolCallsSequential`) left that body
  stranded for the session, since no `tool_execution_end` follows; and it is never
  set at all on a non-streaming reply, where `pendingTools` is only ever populated
  from `message_update` and the row is built at `tool_execution_start` instead —
  which would have hidden the plan outright on that path. `executionStarted` is
  per call, implies whole arguments, and is the call's own turn. Considered and declined: `ui.custom`
  returning a subclass of pi's exported `ExtensionSelectorComponent` with
  `children[2]` swapped for a `Markdown`. It is about fifteen lines and keeps
  pi's border, list and key handling, but the index is a positional assumption
  about a layout pi does not document, so design rule 7 charges it a coupling
  entry and a `stability.test.mjs` pin — and the dialog would still not scroll,
  which is the part that actually limits a long plan. (2) The status line's right
  side takes `paintMode`: `execute` in the theme's success, `plan` in warning —
  the pair `planRenderers` already gives approved and not approved — with the
  approval setting beside it in dim. No glyph, since the word carries the meaning
  and rule 1's set is worth keeping small. The approval word also fixes a dead
  call: `/approvals` published `broker.policy.mode`, so changing between `auto`
  and `ask` re-set the string it was already showing; both call sites now go
  through one `publishStatus` that emits `"<mode> <approval>"`, and the footer
  splits and paints it at render time, where the theme is live. The composed line
  was being truncated whole, which clips the right side first: with both usage
  windows the left is 73 columns on its own, so `execute · auto` needed 92 to
  survive and an 80-column terminal lost the approval word — leaving `plan · a…`
  for both settings. The left is now truncated against the space the mode does
  not need, so the mode and its approval stay whole and the branch gives way. The
  pre-existing clipping was left alone until this change made two states render
  alike. Declined from the same review: shedding the two-column margins and the
  gap so the mode survives between eleven and fifteen columns. The margins are
  rule 8, the model id alone is longer than that terminal, and no one has run one.
  Not applied or
  live-tested on the host — pi is not installed here, so the rendering is
  test-verified only; `npm run test:pi` is green (239 pass, 7 skipped, 0 fail).

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
