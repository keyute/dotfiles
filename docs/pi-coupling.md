# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7). Re-check on every pin bump; `npm run test:pi` is
the gate. Moved here from `~/.pi/agent/docs/harness.md` on 2026-09-12: its
consumers are sessions editing this repo, not runtime pi sessions. Source pins
name the files a package ships: pi-subagents publishes compiled `src/**/*.js`
plus `.d.ts` (its `extension-api.md`, "Published package vs source checkout"),
pi-web-search and pi-mcp-adapter ship `.ts` (2026-09-22).

- Documented pi surfaces: tool renderers (`renderShell: "self"`,
  `context.expanded/toolCallId/invalidate/state`), `registerMarkdownTransformer`,
  `appendEntry`/`registerEntryRenderer`, `setFooter`, `setHeader`,
  `setEditorComponent`, `setWidget`, `setWorkingVisible`, the `outputPad` and
  `hideThinkingBlock` settings, the `agent_start/agent_end/agent_settled`,
  `message_update/message_end`, `tool_execution_*`, `ui_prompt_*` and `input`
  events; pi-subagents' `subagents:rpc:v1` status reply and
  `subagent:async-started/complete` and `subagent:process-terminal` events.
  Detached-run cleanup requires observed proof, not logical completion; its
  root shutdown hook precedes the plugin's RPC disposal, including headless
  sessions. A capped history alone is not failure; remaining unaccounted active
  work is. `fleet.test.mjs` and `integration.test.mjs` cover this ordering and
  evidence; `stability.test.mjs` checks imports and, since 0.87.1 moved the event and API reference out of `docs/extensions.md`, the `on()` overloads and API members in the shipped extension declarations (2026-09-23).
- Plugin rows: pi-subagents, pi-mcp-adapter and web-search receive a Proxy of
  the extension API whose `registerTool` swaps `renderShell`/`renderCall`/
  `renderResult` and, for `subagent` only, narrows its schema from managed
  accepted-key definitions and replaces its description from the trusted
  rendered `subagent-tool-description.md` (missing/empty fails installation;
  `index.mjs` `pluginApi`; `subagent`, `bg_wait`, the
  supervisor channel, `mcp`, `mcpScript`, `mcp__*`, `web_search`,
  `url_context`). The wrapper retains the executor, and launch/
  control enforcement is unchanged; it rests on plugins registering through
  the API they are handed and pi keeping the definition object (`loader.js`).
  Rows read `args` and the result text; the two `details` reads are the
  adapter's `error` (failures it reports without `isError`) and pi-subagents'
  `asyncId` (a launch; the fleet also keeps its documented `asyncDir`). `stability.test.mjs` pins registrations and both fields;
  `plugin-api.test.mjs`, `render.test.mjs` and `integration.test.mjs` gate schema,
  description safety and actual package registration without a fork (2026-09-22).
  No upstream prose slicing; revisit this override when the plugin exposes a
  description option that can omit disabled workflow APIs and their guidance.
- MCP public settings `namespaceProxyTools: false`, `jev: false` and
  `freezeDirectTools: true` keep gateway/direct Context7 exposure, lexical search
  and a stable tool surface after initialization. The initial sync may still
  notify, including on a deferred first connection; proxy metadata remains live.
  `mcp-lifecycle.test.mjs` uses local stdio fixtures to cover cold/warm caches,
  peer cache writes, reconnects and peer shutdown. Cache schema/hash helpers are
  test-only internals. This is not complete cache isolation: the adapter's shared
  name-keyed cache still races and hashes the wrapper rather than the resolved
  broker connection. Revisit when upstream supports connection-scoped or
  instance-scoped metadata storage (2026-09-22).
- Acceptance and mutation names: pi-subagents 0.70.1 dropped its completion
  guard (the read-then-prose failure the roles were tuned for on 2026-09-18) for
  acceptance inference keyed on `acceptanceRole` alone — `writer` infers checked
  evidence plus a required review by its bundled `reviewer`, which would launch
  outside the tier policy, and an omitted role adds an attestation section to
  the child prompt. Read-only roles therefore declare `acceptanceRole:
  read-only` (infers none, adds nothing) and write roles
  `acceptance: {"level":"none",…}` (the driver verifies from the diff), keeping
  `mutationTools: workspace_bash, workspace_edit, workspace_write` plus
  `subagent` where they nest, since renamed tools are otherwise invisible to
  the long-running guard's mutation check and the run's mutation evidence
  (`pi-roles`, `subagent-pi.md`); `stability.test.mjs` pins the three
  frontmatter reads and the name check (2026-09-22).
- The quiet completion notice: the same `pluginApi` Proxy intercepts
  `sendMessage` and sends pi-subagents' completion notice with `display` off
  (`docs/pi-design.md` rule 4, 2026-09-12). Rests on the plugin sending that
  notice as the literal customType `subagent-notify` through the API it is
  handed, and on pi drawing a custom message only when its `display` flag is
  truthy. Both pinned in `stability.test.mjs`. During shutdown, results still
  reach the transcript but cannot request a new model turn (`triggerTurn: false`);
  `plugin-api.test.mjs` covers this exception (2026-09-16).
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
  `shouldTriggerFileCompletion` itself, as `/cmd` plus a trailing space trims
  to a slash command pi refuses to force-complete. `CaretEditor` re-issues the
  key after a Tab accept that lands on the command's space or a directory
  separator, since the accept cancels the menu and nothing re-opens it. All
  three behaviours pinned in `stability.test.mjs`; `caret.test.mjs` drives the
  walk through pi's own provider.
- Exported but undocumented: `renderDiff` and `getMarkdownTheme` (stability
  test covers the export). `CustomEditor` is documented since pi 0.87.0, but the
  render shape the prompt relies on — `renderTopBorder`/`renderBottomBorder`,
  `setPaddingX`, the first content line's padding columns — is not;
  `caret.test.mjs` pins it. Shell mode additionally relies on Editor's `state`,
  `layoutText`, `buildVisualLineMap`, `setCursorCol`, `handleBackspace` and undo
  snapshot methods: layout reads a temporary prefix-free state, visual columns
  map back to native text, and Backspace removes the mode prefix atomically.
  Native history, paste and submission retain their original text. Real-editor
  wrapping/navigation/undo tests and `stability.test.mjs` pin these seams; retire
  them when Pi exposes a shell-mode/prompt-prefix editor API (2026-09-22).
- The owned questionnaire directly uses public `custom` and `Markdown`;
  native paste expansion preserves complete notes and free answers (2026-09-17).
- Inline dialog text (plan feedback, questionnaire notes and free answers) retains `Editor.render()` for wrapping, cursor and navigation geometry,
  dropping its first/last border rows at one site, `dialog.mjs`'s field. `plan-approval.test.mjs` pins that render shape,
  Unicode cursor and wrapped navigation alongside the placeholder (2026-09-21).
- Mouse: the fold handle answers clicks on its summary line from its own
  `handleMouse`; rests on pi-tui's `MouseRegion` asking the child before its
  own handler and on `ToolExecutionComponent` forwarding self-shell mouse
  events one row up (`y - 1`). Reasoning stays out because pi-tui's `Markdown`
  renders no line when the transformer returns "" (an empty hidden-thinking
  label is not empty: pi wraps it in colour codes, which rendered an
  invisible clickable line). Pinned in `stability.test.mjs`.
- Row spacing: pi's `ToolExecutionComponent` puts one spacer above each row
  and returns no lines at all, spacer included, for a self-shelled row whose
  content renders none; a group's hidden members lean on it, so a group is one
  block under one blank line (`docs/pi-design.md` rule 8). Pinned in
  `stability.test.mjs`; `transcript.test.mjs` mounts the real component and
  asserts the lines, blanks included, at every level of detail (2026-09-18).
  Native tool images render outside the self-shell row; managed
  `terminal.showImages: false` removes their preview components without changing
  result content. A real-component test gates folding without stray previews or
  gaps. User-shell boundaries use the documented `user_bash` event because
  `recordBashResult` does not emit a normal `message_end` (2026-09-22).
- Unified activity groups: tools and successful completions share one timeline.
  An entry renderer gets no invalidate handle, so a completion-led group reads
  the timeline at paint time and repaints through the footer's `tui.requestRender()`;
  later completion members return `undefined`. Under Ctrl+O each tool result carries
  only the completions immediately following it, preserving order after its output.
  A completion arriving behind a pending call starts a new group: otherwise that
  call's later failure could strand an entry whose component was already omitted. Rests on `CustomEntryComponent` adding its
  spacer only around a returned component, on `addCustomEntryToChat` skipping
  an entry without content, and on pi-tui's `Container` dispatching a click to
  the child under it (the group's handle). All pinned in `stability.test.mjs`;
  `CustomEntryComponent` is not exported, so `transcript.test.mjs` asserts the
  block's own lines and the blank above it rests on the pin. Residuals: a
  transcript rebuilt from a branch that lacks a group's first entry drops that
  group's later members; pi inserts a completion above a streaming reply while
  the timeline is event-ordered, so two completions with a text chunk between
  them sit adjacent but ungrouped, as before this change (2026-09-18).
- Heuristic: fleet rows pair with async runs by agent label, a 30 s start
  window and sibling rank (`fleet.mjs` `runIdFor`); the DTO's keys are opaque
  and its `goal` is never filled in 0.70.1. `fleet.test.mjs` pins it; the
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
- The fleet peek replays `<asyncDir>/events.jsonl`: the file and `asyncDir` (the
  launch result's `details.asyncDir`, `observability.md`) are documented, and
  so is the file's content in outline (the child's pi events with
  `message_update` dropped); the record annotations are not — the events
  (`tool_execution_start/end`, `message_end`) carry `subagentSource:
  "child"`, `subagentRunId`, `subagentStepIndex`, `subagentAgent`, `observedAt`,
  capped at 50 MiB with one `subagent.events.truncated` record and nothing
  after; the runner's own `subagent.steer.*` receipts share the file through
  an uncapped writer and carry no annotation, so records are read by `type`.
  A steer reaches the child as a user message opening `Mid-run steering from
  the parent orchestrator:` (`Queued follow-up …` for `follow_up`) and closing
  with the `Incorporate this guidance…` line, which the replay strips; the
  `steer` RPC blocks up to 3 s for its receipt, so the peek's call outlives
  the fleet poll's 2 s timeout. The header's current tool is
  `asyncSnapshot.runs[].activity.currentTool`, a source shape beside the
  documented `runs[].id`. All pinned in `stability.test.mjs`; each entry
  retires when pi-subagents documents the shape or serves it over RPC
  (2026-09-22).
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
  earlier reasoning no longer reaches the new model as plain text. A
  `message_update` handler swaps blanked copies into the event's message too,
  so the streaming component spaces the same way while it is still typing;
  this rests on pi emitting to extensions before listeners with the same
  per-event shallow-copied message. All pinned in `stability.test.mjs`
  (2026-09-18).
- Outside the npm pin: the status line's usage segments come from
  `GET chatgpt.com/backend-api/wham/usage`, called directly with pi's
  stored `openai-codex` credential (the exported `readStoredCredential`; its
  field shape is pinned in `stability.test.mjs`). The token is never refreshed
  there: refresh tokens rotate, so a footer refresh racing pi's own would
  invalidate the login — an expired credential skips the read and pi's next
  model call restores it. The endpoint is an unversioned ChatGPT backend
  surface; its window fields (`rate_limit.primary_window/secondary_window`:
  `used_percent`, `limit_window_seconds`, `reset_at`) had only grown
  additively over their observable history (verified 2026-09-11). Re-verify trigger: segments missing on
  a live turn with a fresh login — check the response shape, not the parser.
  A failed read only drops the segments.
- Outside the npm pin: herdr's bundled pi extension (integration v9, herdr
  0.9.1) is the pane's lifecycle authority and reports `blocked` only on the
  `herdr:blocked` `{ active, label }` bus event, ref-counted — it does not read
  pi's `ui_prompt_*`. `index.mjs` bridges the prompt span to it so plan
  approval, questions and broker confirms raise herdr's needs-input
  notification; pi-subagents emits the same event for async children
  (`extension-api.md`). Re-check when the herdr integrations script re-fires
  on an upgrade; delete the bridge once herdr's extension subscribes to
  `ui_prompt_*` itself, or each prompt counts twice (2026-09-18).
