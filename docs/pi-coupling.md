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
pi's modular `dist/**` — the CLI runs `dist/bundle/cli.js` built from the
same source, so a bundle-only change passes the pins; the bundled-entry test
in `skill-display.test.mjs` is the one check on the code the TUI executes.

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
  every payload of those types). Its `sendUserMessage` turns pi-subagents'
  idle-parent wake (a steer starting `Inspect subagent updates above.`, named
  `PARENT_WAKE_TEXT` in the plugin's docs but not exported) into a hidden
  custom message that triggers the turn, dropped while shutting down; other
  user text passes through. After a UI abort the plugin sends no wake until the
  parent's next run.
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
  custom messages; the wake branch when pi can draw an extension's user message
  quietly. A changed wake literal falls back to a visible wake box by itself;
  an option key the plugin's hints teach beyond the owned schema's is rejected
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
  *Why:* rule 5's shell block; pi has no renderer
  hook for its own. *Residual:* no `bash_execution_update`, no full-output file
  on truncation, no pi pending shell component. *On red:* repair. *Retire:*
  when pi exposes a renderer for its shell block.
  *Pin:* `stability.test.mjs`.
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
  when no completion follows). pi-subagents' wake, converted to a triggered
  custom message, is busy from the send; an extension's `sendUserMessage` wake
  counts as busy only after pi's `input` handlers and auth check, so the footer
  holds the close from that wake's extension `input` until its `agent_start`
  (at most 10 s). *Why:* rules 3 and 4. *On red:* fall back to pi's own working row
  (`setWorkingVisible` left on); lost: the column-0 row with a trailing blank
  line and the waiting row. On the ordering pins, close only
  at `agent_settled`; lost: the close when the last work ends with no wake.
  *Pin:* `stability.test.mjs`, `footer.test.mjs`, `fleet.test.mjs`.
- **Prompt span** (`dialog.mjs` `openView`/`openWait`/`blocksUser`): pi wraps
  every `ctx.ui.custom` in one `custom` prompt span, emits `ui_prompt_*` only
  for the outermost prompt, and its end carries that prompt's kind; its own
  terminal status never marks a custom dialog blocked. A custom dialog is a
  view unless `openWait` mounts it (plan approval, the questionnaire); herdr
  `blocked` and `Waiting for you…`, one footer flag, take only native prompts
  and waits, pairing the end with that flag. A dialog opened inside a view's span (the
  peek, `/plan show`) would go unreported, so views mount through `openView`
  and `closeView` returns the mount, settled after pi's span closes; `openWait`
  and the broker confirm await it. A native prompt another extension opens
  over a view (pi-subagents' authority and spawn-budget confirms) has no such
  hook and goes unreported. *Why:* opening a peek marked herdr blocked
  and swapped the working row's clock. *On red:* fall back to forwarding every
  prompt; lost: a view marks herdr blocked and shows `Waiting for you…`. *Pin:*
  `stability.test.mjs`, `footer.test.mjs`, `fleet.test.mjs`,
  `approval.test.mjs`, `plan-approval.test.mjs`, `questionnaire.test.mjs`.
- **herdr reporter** (`herdr.mjs`, `footer.mjs` `onActivity`): the root TUI
  reports the footer's turn to herdr's socket as `pane.report_agent` and
  `pane.report_agent_session` under source `herdr:pi`, agent `pi` — herdr's
  own integration identity (its docs reserve the `herdr:` prefix), the only
  pi source herdr gives full-lifecycle authority (screen state is ignored).
  The protocol is copied from herdr's bundled pi extension v9: one JSON line
  per connection, acked by the first reply byte, retried once (500 ms, then
  1500 ms); seq seeded at `Date.now()*1000`, accepted only above the source's
  last. Idle is held 250 ms so the gap before a follow-up run reports no done.
  herdr's own extension is uninstalled
  (`run_onchange_after_zz-herdr-integrations.sh.tmpl`) and not loaded (`~/.zshrc`
  `pi`, `--no-extensions`). *Why:* rule 4 — herdr's extension went idle (done)
  at every `agent_settled` while async children or shells still ran.
  *Residual:* runs restored by `/resume` are live with no open turn, so idle;
  a user-opened menu (`/approvals`) reports blocked, playing herdr's Request
  sound; plan approval and the questionnaire report blocked with no title; if
  both delivery attempts fail, the last state stays until the next change.
  *Re-verify:* on a herdr upgrade — its embedded pi extension still speaks v9's
  params, and a waiting row shows `working` in `herdr pane get`. *On red:*
  reinstall herdr's pi integration and restore the zshrc `-e`; lost: working
  across child waits, one done per turn. *Retire:* when herdr's pi integration
  reports a turn that outlives `agent_settled`. *Pin:* `herdr.test.mjs`,
  `footer.test.mjs`.
- **Hidden reasoning** (`rows.mjs` `installReasoningHide`): wraps the
  exported `AssistantMessageComponent.prototype.updateContent` once, on the
  host class the extension entry passes, drawing from a copy without
  `thinking` blocks; rests on every draw passing through it. Since pi spaces
  two text blocks apart only after a thinking run, the wrapper then puts a
  `Spacer` between adjacent `Markdown` children of the TS-private
  `contentContainer` (matched by class name: pi may resolve its own pi-tui).
  *Why:* rule 2's "takes no space" (earendil-works/pi#8154) and rule 8's one
  blank between text blocks. *On red:* set `hideThinkingBlock: true` in
  modify_settings; lost: "takes no space" — pi's label, its spacer and click
  region return — and two text blocks with no thinking between sit flush. *Retire:* when pi can hide reasoning outright. *Pin:*
  `stability.test.mjs`, `rows.test.mjs`, `transcript.test.mjs`.
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
  adopted run id),
  the busy-parent no-wake branch of `parent-wake.js`, the internal `structured_output` tool
  name in the contract allowlist, and pi-codemode's `DEFAULT_TIMEOUT_MS`.
  *Why:* the blocking runner and schema results, and the workflow view's
  per-agent elapsed and tokens. *Residual:* a notice batching
  an owned and an unowned run, or a late owned one reaching an idle root, is
  forwarded hidden with its wake; a child completing before its spawn reply
  registers it still has its notice forwarded; the notifier's
  pending-delivery flag stays set for dropped notices (pi-web liveness only).
  *On red:* repair; fall back to one `subagent` launch per child with its
  completion notice — lost: schema results and the blocking consolidated
  result. *Retire:* each seam when pi-subagents documents it or offers a
  host-consumed-completion seam. *Pin:* `stability.test.mjs`,
  `orchestrate.test.mjs`.
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
