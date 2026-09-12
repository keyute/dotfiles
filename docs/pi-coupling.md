# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7). Re-check on every pin bump; `npm run test:pi` is
the gate. Moved here from `~/.pi/agent/docs/harness.md` on 2026-09-12: its
consumers are sessions editing this repo, not runtime pi sessions.

- Documented pi surfaces: tool renderers (`renderShell: "self"`,
  `context.expanded/toolCallId/invalidate/state`), `registerMarkdownTransformer`,
  `appendEntry`/`registerEntryRenderer`, `setFooter`, `setHeader`,
  `setEditorComponent`, `setWidget`, `setWorkingVisible`, the `outputPad` and
  `hideThinkingBlock` settings, the `agent_start/agent_end/agent_settled`,
  `message_update/message_end`, `tool_execution_*`, `ui_prompt_*` and `input`
  events; pi-subagents' `subagents:rpc:v1` status reply and
  `subagent:async-started/complete` events. `stability.test.mjs` checks every
  import and event name against the package exports and docs.
- Plugin rows: pi-subagents, pi-mcp-adapter, the questionnaire and
  web-search plugins receive a Proxy of the extension API whose
  `registerTool` swaps `renderShell`/`renderCall`/`renderResult` on every
  registration (`index.mjs` `pluginApi`; `subagent`, `bg_wait`, the
  supervisor channel, `mcp`, `mcpScript`, `mcp__*`, `ask_user_question`,
  `web_search`, `url_context`); rests on the plugins
  registering through the API they are handed and pi keeping the definition
  object (`loader.js`). Rows read `args` and the result text; the two
  `details` reads are the adapter's `error` (failures it reports without
  `isError`) and pi-subagents' `asyncId` (a launch). earendil-works/pi#3541
  closed completed 2026-04-22, but the pinned SDK still ships no
  renderer-override API (checked 2026-09-12; re-check at the next pin bump);
  `stability.test.mjs` pins the registrations and both fields.
- The quiet completion notice: the same `pluginApi` Proxy intercepts
  `sendMessage` and sends pi-subagents' completion notice with `display` off
  (`docs/pi-design.md` rule 4, 2026-09-12). Rests on the plugin sending that
  notice as the literal customType `subagent-notify` through the API it is
  handed, and on pi drawing a custom message only when its `display` flag is
  truthy. Both pinned in `stability.test.mjs`.
- Session surfaces: pi's `resetExtensionUI` (on `/new`, `/resume`) clears the
  header, footer and custom editor, so `session_start` re-applies them every
  time; pinned in `stability.test.mjs`.
- Tab completion: the documented `addAutocompleteProvider` wrapper
  (`index.mjs` `argumentCompletions`, re-added on every `session_start` and
  self-idempotent, since pi stacks providers and `/reload` re-emits
  `session_start` without the reset that clears them) re-issues a forced
  request unforced, because pi routes Tab in a command's arguments to forced
  file completion (`handleTabCompletion`) and its provider guards the whole
  slash branch on `!options.force`; it also answers
  `shouldTriggerFileCompletion` itself, as `/cmd ` trims to a slash command pi
  refuses to force-complete. `CaretEditor` re-issues the key after a Tab accept
  that lands on the command's space or a directory separator, since the accept
  cancels the menu and nothing re-opens it. All three behaviours pinned in
  `stability.test.mjs`; `caret.test.mjs` drives the walk through pi's own
  provider.
- Exported but undocumented: `renderDiff`, `keyHint`, `getMarkdownTheme`,
  `CustomEditor` (stability test covers the export; `caret.test.mjs` pins the
  render shape the prompt relies on — `renderTopBorder`/`renderBottomBorder`,
  `setPaddingX`, the first content line's padding columns).
- Mouse: the fold handle answers clicks on its summary line from its own
  `handleMouse`; rests on pi-tui's `MouseRegion` asking the child before its
  own handler and on `ToolExecutionComponent` forwarding self-shell mouse
  events one row up (`y - 1`). Reasoning stays out because pi-tui's `Markdown`
  renders no line when the transformer returns "" (an empty hidden-thinking
  label is not empty: pi wraps it in colour codes, which rendered an
  invisible clickable line). Pinned in `stability.test.mjs`.
- Heuristic: fleet rows pair with async runs by agent label, a 30 s start
  window and sibling rank (`fleet.mjs` `runIdFor`); the DTO's keys are opaque
  and its `goal` is never filled in 0.66.0. `fleet.test.mjs` pins it; the
  upstream fix is a `goal`-populating DTO. Completion lines take each result's
  resolved `status` from the `subagent:async-complete` payload (the result
  file spread plus `runId`), falling back to `state`, `success` and `agent`,
  the duration from the same file's `durationMs` (launch to end), and the task
  from the launch's own tool events, since `async-started` redacts it. Row
  text assumes the bash tool's `(no output)` stand-in and `Command exited
  with code N` trailer, and pi's per-row click toggling one row's `expanded`
  (a body only; a closed fold reopens when the documented
  `ctx.ui.getToolsExpanded()` value changes, i.e. on Ctrl+O). All pinned in
  `stability.test.mjs`.
- srt's `CLAUDE_CODE_TMPDIR` environment variable, read when it wraps a
  command, names the `TMPDIR` it exports into that command; `sandbox-runner.mjs`
  sets it to the lease's scratch path. Documented only in srt's source comment
  (`generateProxyEnvVars`, 0.0.75) and pinned in `sandbox-runner.test.mjs`.
- Plugin data the rows and policy read: pi-web-search's `details.error` and
  its `web_search`/`url_context` names; the SDK bash schema being a plain
  object whose `properties` take the `run_in_background` flag. All pinned in
  `stability.test.mjs`, with `pi.sendMessage`, `ctx.ui.input` and
  `ctx.ui.select` checked against the docs.
- The working row above the composer: pi's own row is a column in under a
  blank line (pi-tui's `Loader` hardcodes both) and `setWidget`'s string form
  wraps its lines in the same indent, so the extension subclasses `Loader` and
  drops that leading line; it rides `setWidget`'s documented component form at
  `placement: "aboveEditor"`, which pi docks between the status container and
  the composer; it stands down for pi's compaction indicator, and pi's
  auto-retry countdown (no documented event) shows alongside it. Pinned in
  `stability.test.mjs`.
- Blanked reasoning: pi spaces an assistant message from its raw reasoning
  before any display hook runs (earendil-works/pi#8154), so a `message_end`
  handler blanks the thinking text. Rests on the OpenAI Responses replay
  sending the opaque reasoning item alone (`JSON.parse(block.thinkingSignature)`
  in pi-ai's `openai-responses-shared.js`, which also stores the provider's own
  summary) and on the Anthropic replay sending the text with its signature,
  which is why the handler is gated on `message.api`. Accepted cost:
  `transformMessages` keeps a signed block only where provider, api and model
  id all match and drops one whose text is empty, so after a model change the
  earlier reasoning no longer reaches the new model as plain text. All pinned
  in `stability.test.mjs`.
- Outside the npm pin: the status line's usage segments come from
  `GET chatgpt.com/backend-api/wham/usage` — the read behind codex's own
  usage display, but called directly so pi needs no codex binary — with pi's
  stored `openai-codex` credential (the exported `readStoredCredential`; its
  field shape is pinned in `stability.test.mjs`). The token is never refreshed
  there: refresh tokens rotate, so a footer refresh racing pi's own would
  invalidate the login — an expired credential skips the read and pi's next
  model call restores it. The endpoint is an unversioned ChatGPT backend
  surface; its window fields (`rate_limit.primary_window/secondary_window`:
  `used_percent`, `limit_window_seconds`, `reset_at`) had only grown
  additively over their observable history (verified against
  openai/codex `c210f4c`, 2026-09-11). Re-verify trigger: segments missing on
  a live turn with a fresh login — check the response shape, not the parser.
  A failed read only drops the segments.
