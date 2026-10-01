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
  extension API whose `registerTool` applies the plugin row renderers to every
  tool registered through it, and replaces the schema and description of
  `subagent`; executors are kept. Its `sendMessage` sends the plugin's quiet
  notices with display off and, mirroring `sendCustomMessage`'s branches,
  closes the activity group for a displayed message `_appendCustomMessage`
  draws outside the agent stream (no extension event sees it); its
  `appendEntry` closes for an entry whose plugin renderer guard says it draws.
  Owned renderers parse pi-subagents' payloads for its four unrendered notice
  types (`NOTICE_RENDERERS`), answering undefined on an unknown one. *Why:*
  rules 2, 4, 9 and 10 for plugin output, and the model sees only calls the
  `tool_call` hook admits. *On red:* repair — the TUI's plugin rows, the quiet
  notices and the plugin boundaries ride it; a changed payload falls back to
  pi's shaded box by itself. *Retire:* the `subagent` override when the plugin
  exposes a description option that can omit disabled workflow APIs and their
  guidance; the send boundary when pi emits an extension event for appended
  custom messages. *Pin:* `stability.test.mjs`, `plugin-api.test.mjs`,
  `integration.test.mjs`, `render.test.mjs`.
- **Resumed MCP rows** (`index.mjs` `mcpPlaceholder`): pi builds a resumed
  tool row with the definition registered when it renders, before MCP
  connects and registers, so a hidden placeholder carrying the row renderers is
  registered on the raw API for each `mcp__*` name in the branch (startup
  renders after `session_start`) and, at load, for each name met earlier in
  the process (an in-process switch renders before it); MCP's own
  registration replaces it by name. *Why:* rule 9 — pi's fallback is a shaded
  card. *Residual:* a name first met in a session never live in this process
  keeps the card. *On red:* fall back to pi's card for resumed MCP calls,
  deleting the placeholders. *Retire:* when pi re-resolves a row's definition
  or MCP registers before the first render. *Pin:* `stability.test.mjs`,
  `integration.test.mjs`.
- **Skill display**: wraps `InteractiveMode`'s undocumented
  `getUserMessageText` once, turning a native `parseSkillBlock` match back into
  `/skill:name` plus arguments; the host class comes from pi's virtual modules,
  since the bundled CLI and unbundled SDK export different classes. *Why:* rule
  5's single user box. *On red:* fall back to pi's native skill card; lost: the
  single box — the skill shows as a second block with its instruction body.
  *Retire:* when pi exposes a user/skill-message renderer. *Pin:*
  `stability.test.mjs`, bundled-entry and real-render tests.
- **Pending input**: replaces only `InteractiveMode.updatePendingMessagesDisplay`
  on the same host class; pi keeps queue ownership. *Why:* rule 5, queued
  input. *On red:* fall back to pi's native pending display; lost: the shaded
  `❯` blocks and their `π` labels. *Retire:* when pi offers a pending-input
  renderer. *Pin:* `stability.test.mjs`, render/lifecycle tests.
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
  the `subagent.events.truncated` marker, the steer receipt's `requestId` and
  error fields, the steer message's prefix and trailer text, `observedAt`, and
  `asyncDir` read back from the branch's `subagent` results after a resume.
  Peek's native editor is shaped at its bottom-border callback (undocumented).
  *Why:* rule 6's peek. *On red:* repair. *Retire:* each record seam when
  pi-subagents documents the shape or serves it over RPC; the render-shape seam
  when Editor offers a borderless, height-bounded render API. *Pin:* `stability.test.mjs`.
- **Working row**: a pi-tui `Loader` subclass docked through `setWidget`'s
  component form above the editor; it stands down for pi's compaction indicator,
  and pi's auto-retry countdown shows alongside it. *Why:* rule 3. *On red:*
  fall back to pi's own working row (`setWorkingVisible` left on); lost: the
  column-0 row with a trailing blank line and the frozen settled-root snapshot.
  *Pin:* `stability.test.mjs`.
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
  `_runAgentPrompt`. *Why:* an idle triggerTurn skips `before_agent_start`, and pi swallows
  handler throws. *On red:* repair. *Retire:* upstream routes triggerTurn through
  `before_agent_start` and lets a handler block. *Pin:* `stability.test.mjs`, `integration.test.mjs`.
- **Usage segments** (outside the npm pin): unversioned
  `GET chatgpt.com/backend-api/wham/usage`, read with pi's stored
  `openai-codex` credential (`readStoredCredential`) and its
  `rate_limit.primary_window/secondary_window` fields (`used_percent`,
  `limit_window_seconds`, `reset_at`); a failed read only drops the
  segments. *Why:* rule 3.
  *Re-verify:* segments missing on a live turn with a fresh login — check the
  response shape, not the parser. *Retire:* for `@hk_net/pi-usage-bars` if the
  endpoint breaks, losing the segments inside rule 3's single status line.
  *On red* (the credential field shape): repair. *Pin:* `stability.test.mjs`
  (the stored credential's fields only; the endpoint has no pin).
