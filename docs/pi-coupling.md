# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7); `npm run test:pi` is the gate on every pin bump
and a pin's claim string holds the mechanics. Each entry names the seam, its
why, any accepted residual, *On red:* (a failing pin on a bump: **repair** the
seam, or **fall back** to the named native surface, deleting the owned one and
accepting the named loss), *Retire:* where known, and its *Pin:* tests. An
entry's part outside the npm pin cannot go red and carries *Re-verify:*; a new
owned surface states its *On red:* when it lands. A seam with no entry is
repair-only and carries only its pin. Source pins name shipped files:
pi-subagents compiled `src/**/*.js` plus `.d.ts`, pi-web-search `.ts`, and
pi's modular `dist/**`. pi-subagents executes its exported `bundle/*.js`;
reachable-bundle pins and exported-entry integration/notification tests cover
that path too. Pi's CLI runs `dist/bundle/cli.js`; the bundled-entry test in
`skill-display.test.mjs` checks the host classes the TUI executes.

- **Plugin tool Proxy** (`plugin-api.mjs` `pluginApi`): pi-subagents,
  pi-web-search and pi's own MCP and tool-search factories get a Proxy of the
  extension API whose `registerTool` records every tool name registered
  through it, for the documented `registerToolRenderer` resolver that gives
  those tools the plugin row, and replaces the schema of `subagent` with an
  owned static one and its description; executors are kept. Its `sendMessage` sends the plugin's quiet
  notices with display off and, mirroring `sendCustomMessage`'s branches,
  closes the activity group for a displayed message `_appendCustomMessage`
  draws outside the agent stream (no extension event sees it); its
  `appendEntry` closes for either entry type pi-subagents draws (it draws
  every payload of those types). Native completion notices now trigger their
  own turns as custom messages; the Proxy suppresses their turn request while
  shutting down. User messages pass through untouched. After a UI abort the
  plugin sends no wake until the parent's next run.
  Owned rows are composed over pi-subagents' shaded `[subagent]` renderer for
  six notice types (`NOTICE_RENDERERS` and the steering and settle-reminder
  rows), answering undefined on an unknown payload. *Why:*
  rules 2, 4, 9 and 10 for plugin output, and the model sees only calls the
  `tool_call` hook admits. *Residual:* the settle reminders
  (`subagent-completion-unanswered`/`-unhandled`) are appended at
  `agent_before_settle`, outside the Proxy, so they do not end the group above
  them, and an unanswered wake gets one extra turn. *On red:* repair — the
  TUI's plugin rows, the quiet notices and the plugin boundaries ride it; a
  changed payload falls back to the plugin's block by itself. *Retire:* the
  `subagent` override when the plugin can limit both the `subagent` schema and
  its description to named launches plus list, status, interrupt, stop and
  steer (its model schema still exposes workflow, args, model, cwd, worktree
  and output, `action` is a free string and `options` opaque, and
  `toolDescriptionMode: custom` reads a project file first with no trust
  check); the send boundary when pi emits an extension event for appended
  custom messages. An option key the plugin's hints teach beyond the owned
  schema's is rejected
  by pi before the hook, so `integration.test.mjs` validates the hint shapes.
  *Pin:* `stability.test.mjs`, `plugin-api.test.mjs`,
  `integration.test.mjs`, `render.test.mjs`.
- **Skill display**: wraps `InteractiveMode`'s undocumented
  `getUserMessageText` once, turning a native `parseSkillBlock` match back into
  `/skill:name` plus arguments; the host class comes from pi's virtual modules,
  since the bundled CLI and unbundled SDK export different classes. *Why:* rule
  5's single user box. *On red:* fall back to pi's native skill card; lost: the
  single box — the skill shows as a second block with its instruction body.
  *Retire:* when pi exposes a user/skill-message renderer. *Pin:*
  `stability.test.mjs`, bundled-entry and real-render tests.
- **Pending input**: replaces `InteractiveMode.updatePendingMessagesDisplay`
  on the same host class; pi keeps queue ownership. Ctrl+Enter awaits the native
  session's `abort()` without clearing either queue, transfers raw compaction
  input through its native admission methods, then starts a run with a hidden,
  empty `sendCustomMessage` trigger: the agent's initial steering poll consumes
  the queued messages before its first request, keeping follow-ups and
  attachments; the transcript keeps the hidden entry.
  The draft moves synchronously from the composer into that existing raw-input
  queue, so native submit/dequeue actions cannot resend a hidden captured copy.
  `flushCompactionQueue` is held from the abort until the run starts, so
  `compaction_end` cannot start a competing response during abort cleanup. The editor callback
  and lifecycle reset keep old-session work from reaching a replacement.
  *Why:* rule 5's queued-input layout and interrupt-and-send action. *On red:*
  fall back to pi's native pending display and Escape then Enter; lost: grouped
  shaded blocks and single-key send-now. *Retire:* the renderer when pi offers
  a pending-input renderer, the send seam when it offers interrupt-and-send.
  *Pin:* `stability.test.mjs`, render/lifecycle and native queue-loop tests.
- **The owned `!` block**: `CaretEditor` intercepts the `onSubmit` pi assigns
  to a custom editor, parses `!`/`!!` so
  `handleBashCommand` never runs, and runs the command through
  `createLocalBashOperations` in zsh sourcing `~/.zshrc`.
  Completed `!` results use native custom-message steering so the next model
  request sees them, rather than waiting for the whole tool-calling run to end;
  the visible entry is separate from context delivery.
  *Why:* rule 5's shell block; pi has no renderer
  hook for its own. *Residual:* no `bash_execution_update`, no full-output file
  on truncation, no pi pending shell component. Native `clearQueue()` drops queued
  custom messages while restoring only human text; steering does not repair that
  upstream loss path. *On red:* repair. *Retire:*
  when pi exposes a renderer for its shell block.
  One optional separator after `!`/`!!` is hidden with the marker in the
  command view; visual cursor positions map back to unchanged editor text.
  `CaretEditor` also adapts native completed `handlePaste` insertion: the
  registry retains the full payload for exact repeat comparison, while shell
  mode also inspects a leading collapsed paste. A matching preceding marker
  expands using the native paste's undo snapshot. Conflicting live marker ids
  are rekeyed without changing payload text or native registry iteration order;
  later pastes skip literal ids in both visible text and collapsed payloads.
  Backspace uses range deletion when
  literal markers are present, avoiding native renumbering of their text.
  Fullscreen drag endpoints reuse native click mapping and marker-aware
  segmentation; multi-click classification arrives on the synthesized click
  after release. Private state performs range deletion/replacement, suppressing
  the insertion's second undo snapshot, and visual-line/scroll metadata places
  the highlight and advances edge drags. The native capture target, read through
  the host's stable renderer reference, ends autoscroll when fullscreen consumes
  focus-out before extension input listeners. Logical focus loss is deferred a
  microtask because native click focus toggles even the same component off/on;
  the workflow disposes the editor before session replacement and shutdown.
  Mouse completion uses the native list callback before re-opening the same
  directory level as Tab. Within a range, deferred fake-cursor wrappers are
  removed so they cannot reset its highlight; the IME cursor marker stays.
  Copy-on-select and the copy shortcut use public clipboard/preference APIs.
  *Residual:* terminal-owned regular-mode selection is not editable; secondary
  inputs and independent composer wheel scrolling remain native.
  *On red:* repair these composer seams; retire when native editable ranges,
  shell-aware collapse and targeted paste expansion cover them.
  *Pin:* `stability.test.mjs`, `editor.test.mjs`, `caret.test.mjs`.
- **Fleet peek replay**: replays `<asyncDir>/events.jsonl`, whose event
  names, lifecycle record names and mirroring rule (`message_update` dropped)
  pi-subagents now documents (`docs/observability.md`); still undocumented are
  the `subagent.events.truncated` marker, the steer receipt's error fields,
  the steer message's prefix and trailer text, `observedAt`, a child's custom
  entries mirrored as `entry_appended`, and `asyncDir` read back from the branch's `subagent` results after a resume.
  Peek's native editor is shaped at its bottom-border callback (undocumented).
  *Why:* rule 6's peek. *On red:* repair. *Retire:* each record seam when
  pi-subagents documents the shape or serves it over RPC; the render-shape seam
  when Editor offers a borderless, height-bounded render API. *Pin:* `stability.test.mjs`.
- **Working row**: a pi-tui `Loader` subclass docked through `setWidget`'s
  component form above the editor; it stands down for pi's compaction indicator,
  and pi's auto-retry countdown shows alongside it. The waiting row closes when
  the last child or shell ends with the root idle (`ctx.isIdle()` after a 250 ms
  grace): a child is live from `subagent:async-started` until both its
  completion event and its observed process exit (or until 10 s after its exit
  when no completion follows). pi-subagents' native triggering custom notice
  is busy from the send; an extension's `sendUserMessage` wake
  counts as busy only after pi's `input` handlers and auth check, so the footer
  holds the close from that wake's extension `input` until its `agent_start`
  (at most 10 s). *Why:* rules 3 and 4. *On red:* fall back to pi's own working row
  (`setWorkingVisible` left on); lost: the column-0 row with a trailing blank
  line and the waiting row. On the ordering pins, close only
  at `agent_settled`; lost: the close when the last work ends with no wake.
  *Pin:* `stability.test.mjs`, `footer.test.mjs`, `fleet.test.mjs`.
- **Prompt span** (`dialog.mjs` `openView`/`openWait`/`blocksUser`): pi wraps
  every `ctx.ui.custom` in one `custom` prompt span, emits `ui_prompt_*` only
  for the outermost prompt, and its end carries that prompt's kind. Inline
  dialogs now stack; their `blocked` option affects terminal program status,
  not these events. A custom dialog is a view unless `openWait` mounts it
  (plan approval, the questionnaire); terminal status
  `blocked` and `Waiting for you…`, one footer flag, take only native prompts
  and waits, pairing the end with that flag. A dialog opened inside a view's span (the
  peek, `/plan show`) would go unreported, so views mount through `openView`
  and `closeView` returns the mount, settled after pi's span closes; `openWait`
  and the broker confirm await it. A native prompt another extension opens
  over a view (pi-subagents' authority and spawn-budget confirms) has no such
  hook and goes unreported. Closing a view also prevents native dialog stacking
  from restoring it after an answer. *Why:* opening a peek marked terminal status blocked
  and swapped the working row's clock. *On red:* fall back to forwarding every
  prompt; lost: a view marks terminal status blocked and shows `Waiting for you…`. *Pin:*
  `stability.test.mjs`, `footer.test.mjs`, `fleet.test.mjs`,
  `approval.test.mjs`, `plan-approval.test.mjs`, `questionnaire.test.mjs`.
- **Activity-entry visibility** (`rows.mjs` `installActivityEntries`): wraps
  the host `InteractiveMode.addCustomEntryToChat`, retaining every owned
  completion's native host. Its render checks the current `customComponent`
  after native rebuilds and suppresses the host spacer when the child draws
  nothing. Installation precedes historical mounts; completion components stay
  dynamic when session-start reconstruction follows mounting. Public
  `buildContextEntries()` supplies the selected, compaction-aware history to the
  existing fold owner in place; mounted tool rows are invalidated and repainted.
  *Why:* a completion mounted behind a pending tool must become visible after
  failure or merge after success without an artificial group boundary, and a
  resumed completion must join its reconstructed group without a new host hook.
  *On red:* repair; otherwise retain plain visible completion rows rather than
  discard a component that might later be needed. *Retire:* a public entry
  renderer with dynamic zero-height host spacing. *Pin:* native and bundled
  mounts in `transcript.test.mjs` and `skill-display.test.mjs`, `rows.test.mjs`.
- **Hidden reasoning** (`rows.mjs` `installReasoningHide`): wraps the
  exported `AssistantMessageComponent.prototype.updateContent` once, on the
  host class the extension entry passes, drawing from a copy without
  `thinking` blocks; rests on every draw passing through it. Since pi spaces
  two text blocks apart only after a thinking run, the wrapper then puts a
  `Spacer` between adjacent `Markdown` children of the TS-private
  `contentContainer` (matched by class name: pi may resolve its own pi-tui).
  The same assistant-only seam temporarily decorates `markdownTheme`: native
  inline/fenced code highlighting runs first, then `command-display.mjs` colours
  a suggested shell marker. Pi reuses positional Markdown slots and their
  construction-time theme, so the decorator resolves the current palette when
  rendering; native invalidation clears cached lines on theme changes. The
  public Markdown transformer protects standalone suggestions as literal code
  before Markdown can interpret shell punctuation; peek supplies the same
  decorated theme directly. No stored text is changed. *Retire:* the theme decoration when Pi exposes an assistant-only
  Markdown theme hook; *On red:* drop marker colouring, preserving native code
  rendering and command text.
  *Why:* rule 2's always-hidden reasoning and rule 8's one blank between text
  blocks. *On red:* set `hideThinkingBlock: true` in modify_settings and use
  `ctx.ui.setHiddenThinkingLabel("")`; native hidden reasoning takes no space,
  but Ctrl+T can expose it and adjacent text blocks sit flush. *Retire:* when
  native rendering preserves always-hidden reasoning, text-block spacing and
  assistant-only theme decoration. *Pin:* `stability.test.mjs`,
  `rows.test.mjs`, `transcript.test.mjs`, `command-display.test.mjs`.
- **Managed agent runs** (`index.mjs` `installManagedRun`): wraps the host `AgentSession`'s
  `_startRun` with the model and workspace guard; a refused custom trigger is
  appended without a turn. *Why:* pi swallows `before_agent_start` handler
  throws, so no handler can block a run. *On red:* repair. *Retire:* upstream
  lets a handler block a run. *Pin:* `stability.test.mjs`, `integration.test.mjs`.
- **Orchestration launches** (`orchestrate.mjs`): the RPC `spawn` reply's
  `details.runId`/`asyncId`/`asyncDir`, status recovery on
  `rpc-spawn-<requestId>` after a lost reply, the `subagent:async-complete`
  payload's `results[0]` `status`/`structuredOutput`/`output`/`usage`, its
  `durationMs`, and `subagent:async-started`'s `toolCallId` (the spawn alias),
  by which the fleet draws no completion line for a workflow's child (else its
  adopted run id), the internal `structured_output` tool name in the contract
  allowlist, and pi-codemode's `DEFAULT_TIMEOUT_MS`. Its documented worker-exit
  callback keeps admission occupied until the VM worker actually exits.
  *Why:* background ownership, schema results and the workflow view's per-agent
  elapsed and tokens. *On red:* repair; fall back to one `subagent` launch per
  child with its completion notice — lost: scripted coordination and consolidated
  results. *Retire:* each seam when pi-subagents documents it. *Pin:*
  `stability.test.mjs`, `orchestrate.test.mjs`, `integration.test.mjs`.
- **Owned completion consumption** (`plugin-api.mjs`): native
  `pi.idle-wake.v1` reservations and `pi-subagents.queued-completion-wakes.v2`
  tracking are WeakMaps keyed by session manager and scoped by UUID. The native
  notifier records wakes, unanswered completions and exact notice objects before
  sending. Its parent wake checks the bound context's `isIdle()` before reserving
  and directly sending the custom notice. The Proxy wraps that context at
  `session_start` to capture the pre-reservation value for the same stack. It
  validates native state and correlation before claiming owned notices, restores
  a consumed idle reservation synchronously, and cleans exact tracking in a
  microtask after native bookkeeping. Session/state/entry identities guard every
  delayed mutation; consumed notices cannot remain for shutdown persistence.
  *Why:* background workflow children must not wake the root separately or leave
  abandoned-delivery reminders, and consumption must not suppress the next
  unowned completion's wake. *Residual:* mixed owned/unowned notices pass
  through whole, retaining incidental child context but no extra visible workflow
  outcome. Missing or mismatched native state forwards normally. *On red:* repair
  or disable consumption and accept native child notifications; never swallow an
  uncorrelated wake. *Retire:* a public consumed-completion hook. *Pin:*
  `stability.test.mjs`, native notifier/wake cases in `plugin-api.test.mjs`.
- **Usage segments** (`footer.mjs`): Pi's documented
  `after_provider_response` (Codex context only) and `provider_stream_event`
  (Codex provider only) expose stable but unversioned Codex limits. HTTP/SSE
  uses `x-codex-{primary|secondary}-{used-percent|window-minutes|reset-at}`;
  `x-codex-limit-name` is a display label, not bucket identity. WS uses
  `codex.rate_limits.rate_limits` with `primary/secondary` windows
  (`used_percent`, `window_minutes`, `reset_at`), default `codex` bucket only
  (`metered_limit_name` before `limit_name`). Named/model quotas and credits
  are ignored; windows are labeled by duration, not position. Header shape:
  [rust-v0.50.0](https://github.com/openai/codex/blob/rust-v0.50.0/codex-rs/core/src/client.rs)
  versus [rust-v0.160.0](https://github.com/openai/codex/blob/rust-v0.160.0/codex-rs/codex-api/src/rate_limits.rs).
  WS introduced in
  [df000da917952024edd14cb624af8d1e1740a2b5](https://github.com/openai/codex/blob/df000da917952024edd14cb624af8d1e1740a2b5/codex-rs/codex-api/src/rate_limits.rs),
  retaining its shape in rust-v0.160.0. *Why:* rule 3's live limits without polling.
  Native snapshots render immediately and outrank older in-flight GETs,
  including `/usage` reports; fresh native limits suppress automatic GETs
  for 60 seconds, not permanently. One state retains last-good limits on
  failure; without intervening native data a failed `/usage` reports unavailable.
  Startup, completion/run-end events and forced `/usage` retain the existing
  `GET chatgpt.com/backend-api/wham/usage` fallback, using Pi's stored
  `openai-codex` credential without refreshing and the endpoint's
  `rate_limit.primary_window/secondary_window` (`used_percent`,
  `limit_window_seconds`, `reset_at`). No idle polling or deferred reads.
  *Re-verify:* missing or stale limits on a live turn with a fresh login —
  check native payloads and fallback response shape; the external fields have
  no npm pin. *On red:* repair the native seam or fall back to the existing
  usage endpoint, deleting native consumption; repair credential shape changes.
  *Retire:* native parsing when Pi offers a normalized quota event.
  *Pin:* `stability.test.mjs` pins Codex response-header forwarding and raw
  event callbacks before normalization on both SSE and reused WS, SDK event
  forwarding and stored credential fields; `footer.test.mjs` pins historical
  parser fixtures, precedence, freshness and last-good failure behaviour.
