# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7). Re-check on every pin bump; `npm run test:pi` is
the gate. Each entry names the seam, why it exists, any accepted residual, when
to retire it, and the test that fails on the bump; mechanics a pin's claim
string already states live only there. Source pins name the files a package
ships: pi-subagents publishes compiled `src/**/*.js` plus `.d.ts` (its
`extension-api.md`, "Published package vs source checkout"), pi-web-search and
pi-mcp-adapter ship `.ts` (2026-09-22).

- **Documented pi surfaces** (listed so a bump re-checks them): tool renderers
  (`renderShell: "self"`, `context.expanded/toolCallId/invalidate/state`),
  `registerMarkdownTransformer`, `appendEntry`/`registerEntryRenderer`,
  `setFooter`, `setHeader`, `setEditorComponent`, `setWidget`,
  `setWorkingVisible`, the `outputPad` and `hideThinkingBlock` settings, the
  `agent_start/agent_end/agent_settled`, `message_update/message_end`,
  `tool_execution_*`, `ui_prompt_*` and `input` events; pi-subagents'
  `subagents:rpc:v1` status reply and `subagent:async-started/complete` and
  `subagent:process-terminal` events. Detached-run cleanup assumes the root
  shutdown hook precedes the plugin's RPC disposal, headless included, and
  counts only observed completion: unaccounted active work is failure, a capped
  history alone is not. *Pin:* `fleet.test.mjs` and `integration.test.mjs`
  (ordering, evidence); `stability.test.mjs` (imports, `on()` overloads and API
  members in the shipped declarations, where 0.87.1 moved that reference).
- **Plugin tool Proxy** (`index.mjs` `pluginApi`, 2026-09-22). pi-subagents,
  pi-mcp-adapter and pi-web-search get a Proxy of the extension API whose
  `registerTool` swaps the renderers of `subagent`, `bg_wait`, the supervisor
  channel, `mcp`, `mcp__*`, `web_search` and `url_context`, and for `subagent`
  and `mcp` replaces schema and description; executors are kept. `subagent`:
  schema narrowed to managed keys, description from the rendered
  `subagent-tool-description.md` (missing/empty fails installation). `mcp`
  (2026-09-26, `mcpGateway`, adapter 2.36.0): description, `promptSnippet` and
  schema are a pure function of config, without
  `action`/`url`/`target`/`searchMode` or install text. Rows read `args` and
  result text; the only `details` reads are the adapter's `error` and
  pi-subagents' `asyncId` (plus documented `asyncDir`). *Why:* the model sees
  only the calls this workflow admits — upstream's text advertises install,
  auth, UI-message and `mcpScript` calls the `tool_call` hook and
  `scriptMode: false` refuse — without slicing upstream prose. *Retire:* the
  `subagent` override when the plugin exposes a description option that can
  omit disabled workflow APIs and their guidance;
  the `mcp` override when the adapter exposes an option that omits
  install/auth/UI actions. *Pin:* `stability.test.mjs` (registrations, both
  `details` fields); `plugin-api.test.mjs` and `integration.test.mjs` (schema,
  description, real package registration); `render.test.mjs` (no disabled
  workflow API in the rendered subagent description).
- **MCP settings** (2026-09-22): public `namespaceProxyTools: false`,
  `jev: false` and `freezeDirectTools: true`. *Why:* gateway plus direct
  Context7 only, lexical search, a stable tool surface after initialization.
  *Residual:* the initial sync may still notify, including on a deferred first
  connection, and proxy metadata stays live; the adapter's shared name-keyed
  cache races and hashes the wrapper rather than the resolved broker
  connection. pi-mcp-adapter 2.36.0's optional `@earendil-works/pi-ai` peer
  range stops at `^0.86.0`, behind the pinned 0.87.1 (2026-09-26). *Retire:*
  when upstream supports connection- or instance-scoped metadata storage;
  re-check the peer lag when the adapter widens its range or a pi-ai bump
  breaks it. *Pin:* `mcp-lifecycle.test.mjs` (local stdio fixtures; its cache
  schema/hash helpers are test-only internals).
- **MCP logging** (2026-09-24): the adapter's internal `logger.ts` singleton,
  loaded through the adapter's own Jiti instance and set to `warn` before
  installation. *Why:* its default `info` output drew the frozen-tool startup
  diagnostic over the live composer. *Retire:* when the adapter exposes a
  public logging setting or stops routine terminal output. *Pin:* lifecycle
  tests and source pins.
- **Acceptance and mutation names** (2026-09-22): read-only roles declare
  `acceptanceRole: read-only`, write roles `acceptance: {"level":"none",…}`,
  with `mutationTools: workspace_bash, workspace_edit, workspace_write` plus
  `subagent` where they nest (`pi-roles`, `subagent-pi.md`). *Why:*
  pi-subagents infers acceptance from `acceptanceRole` alone — `writer` adds a
  review by its bundled `reviewer` outside the tier policy, an omitted role an
  attestation section — and renamed tools are otherwise invisible to its
  mutation guard and evidence; the driver verifies from the diff. *Pin:*
  `stability.test.mjs`.
- **Quiet completion notice** (2026-09-16): the `pluginApi` Proxy intercepts
  `sendMessage` and sends pi-subagents' completion notice with `display` off;
  during shutdown results still reach the transcript with `triggerTurn: false`.
  *Why:* `docs/pi-design.md` rule 4. *Pin:* `stability.test.mjs`;
  `plugin-api.test.mjs` (the shutdown exception).
- **Session surfaces**: pi's `resetExtensionUI` (on `/new`, `/resume`) clears
  the header, footer and custom editor, so `session_start` re-applies them.
  *Pin:* `stability.test.mjs`.
- **Skill display** (2026-09-24): wraps `InteractiveMode`'s undocumented
  `getUserMessageText` once, turning a native `parseSkillBlock` match back into
  `/skill:name` plus arguments; the host class comes from pi's virtual modules,
  since the bundled CLI and unbundled SDK export different classes. Stored
  messages and model context stay untouched. *Why:* rule 5's single user box.
  *Retire:* when pi exposes a user/skill-message renderer. *Pin:* bundled-entry
  and real-render tests, `stability.test.mjs`.
- **Pending input** (2026-09-24): replaces only
  `InteractiveMode.updatePendingMessagesDisplay` on the same host class, using
  `pendingMessagesContainer`, `getAllQueuedMessages` and `getAppKeyDisplay`;
  pi keeps queue ownership and the adapter only draws shaded input blocks.
  *Retire:* when pi offers a pending-input renderer. *Pin:* render/lifecycle
  tests and source pins.
- **Tab completion**: the documented `addAutocompleteProvider` wrapper
  (`index.mjs` `argumentCompletions`) re-issues a forced request unforced,
  answers `shouldTriggerFileCompletion` itself and is re-added idempotently on
  every `session_start`; `CaretEditor` re-issues the key after a Tab accept on
  the command's space or a directory separator. *Why:* pi routes Tab in a
  command's arguments to forced file completion its slash branch skips, and an
  accept closes the menu with nothing re-opening it. *Pin:*
  `stability.test.mjs`; `caret.test.mjs` walks pi's own provider.
- **Editor render shape** (2026-09-22): exported but undocumented `renderDiff`
  and `getMarkdownTheme`; `CustomEditor`'s undocumented render shape
  (`renderTopBorder`/`renderBottomBorder`, `setPaddingX`, first-line padding);
  shell mode's use of Editor's `state`, `layoutText`, `buildVisualLineMap`,
  `setCursorCol`, `handleBackspace` and undo snapshots. *Why:* the shell-mode
  prefix renders and deletes atomically while native history, paste and
  submission keep the original text. *Retire:* when pi exposes a
  shell-mode/prompt-prefix editor API. *Pin:* `stability.test.mjs`,
  `caret.test.mjs` (render shape), real-editor wrapping/navigation/undo tests.
- **Questionnaire** (2026-09-17): uses public `custom` and `Markdown`; native
  paste expansion preserves complete notes and free answers.
- **Inline dialog text** (2026-09-21): plan feedback, questionnaire notes and
  free answers keep `Editor.render()` for wrapping, cursor and navigation,
  dropping its border rows at one site, `dialog.mjs`'s field. *Pin:*
  `plan-approval.test.mjs`.
- **Mouse**: the fold handle answers clicks on its summary line from its own
  `handleMouse`, resting on `MouseRegion` asking the child first and
  `ToolExecutionComponent` forwarding self-shell events one row up (`y - 1`).
  Reasoning's transformer returns "" so no invisible clickable line renders.
  *Pin:* `stability.test.mjs`.
- **Row spacing** (2026-09-18): `ToolExecutionComponent` renders no line,
  spacer included, for a self-shelled row with no content; a group's hidden
  members lean on it (`docs/pi-design.md` rule 8). Managed
  `terminal.showImages: false` removes native image previews outside the row
  without changing result content. *Pin:* `stability.test.mjs`;
  `transcript.test.mjs` (real component, every detail level).
- **The owned `!` block** (2026-09-24): `CaretEditor` intercepts the `onSubmit`
  pi assigns to a custom editor, parses `!`/`!!` as pi's branch does (shell-mode
  follow-up keys included) so `handleBashCommand` never runs, and runs the
  command through the documented `createLocalBashOperations` with pi's
  `shellPath`/`shellCommandPrefix` from the exported `SettingsManager`, gated on
  the session's `isProjectTrusted()` so an untrusted checkout cannot pick the
  shell; the model's ops-worker `bash -c` stays on bash. Both forms append one
  `workflow-shell` entry; `!` also sends a hidden custom message spelled like
  `bashExecutionToText`; Esc is caught in `handleInput`. *Why:* pi has no
  renderer hook for its shell block. *Residual:* no `bash_execution_update`, no
  full-output file on truncation (block and context say "truncated"), no pi
  pending shell component. *Retire:* when pi exposes a renderer for its shell
  block or a documented submit hook. *Pin:* `stability.test.mjs` (each literal
  by text, not order).
- **Unified activity groups** (2026-09-18): tools and successful completions
  share one timeline; a completion-led group reads it at paint time and
  repaints through the footer's `tui.requestRender()`, since an entry renderer
  gets no invalidate handle. Rests on `CustomEntryComponent`'s spacer rule,
  `addCustomEntryToChat` skipping empty entries and `Container` click dispatch.
  *Residual:* a transcript rebuilt from a branch lacking a group's first entry
  drops that group's later members; two completions with a text chunk between
  them sit adjacent but ungrouped. *Pin:* `stability.test.mjs`;
  `transcript.test.mjs` (the block's own lines; `CustomEntryComponent` is not
  exported).
- **Fleet run matching heuristic** (2026-09-23): fleet rows match active
  top-level named-agent runs by unique exact agent/start time (`fleet.mjs`
  `runIdFor`); ambiguous or missing matches get no control ID and matches never
  rebind to a sibling; the DTO's `goal` is never filled. Completion lines read
  the `subagent:async-complete` payload and take the task from the launch's own
  tool events, since `async-started` redacts it; row text assumes the bash
  tool's stand-in and trailer literals and per-row click toggling. *Retire:*
  the heuristic when upstream supplies the run ID in the fleet DTO. *Pin:*
  `fleet.test.mjs` (matching); `stability.test.mjs` (projection, DTO sources,
  row literals).
- **Fleet peek replay** (2026-09-22): replays `<asyncDir>/events.jsonl`, whose
  path and outline are documented but whose `subagent*` record annotations,
  truncation marker and steer receipts are not; records are read by `type`, the
  steer wrapper lines are stripped, and after a resume `asyncDir` is read back
  from the branch's `subagent` results. Peek's native editor is shaped at its
  bottom-border callback (2026-09-24). *Retire:* each record seam when
  pi-subagents documents the shape or serves it over RPC; the render-shape seam
  when Editor offers a borderless, height-bounded render API. *Pin:*
  `stability.test.mjs`.
- **srt `CLAUDE_CODE_TMPDIR`**: names the `TMPDIR` srt exports into a wrapped
  command; `sandbox-runner.mjs` sets it to the lease's scratch path.
  Documented only in srt's source (`generateProxyEnvVars`, 0.0.75). *Pin:*
  `sandbox-runner.test.mjs`.
- **Plugin data the rows and policy read**: pi-web-search's `details.error` and
  its `web_search`/`url_context` names; the SDK bash schema's `properties` map
  taking the `run_in_background` flag. *Pin:* `stability.test.mjs`, with
  `pi.sendMessage`, `ctx.ui.input` and `ctx.ui.select` checked against the docs.
- **Working row**: the extension subclasses pi-tui's `Loader` and docks it via
  `setWidget`'s documented component form at `placement: "aboveEditor"`. *Why:*
  pi's own row and `setWidget`'s string form hardcode an indent and a leading
  blank line. It stands down for pi's compaction indicator; pi's auto-retry
  countdown (no documented event) shows alongside it. *Pin:*
  `stability.test.mjs`.
- **Blanked reasoning** (2026-09-18): `message_end` blanks the thinking text
  and `message_update` swaps blanked copies into the streaming message, gated
  on `message.api`. *Why:* pi spaces an assistant message from its raw
  reasoning before any display hook runs (earendil-works/pi#8154). *Accepted
  cost:* after a model change, earlier reasoning no longer reaches the new
  model as plain text. *Pin:* `stability.test.mjs`.
- **Usage segments** (outside the npm pin): `GET
  chatgpt.com/backend-api/wham/usage`, an unversioned ChatGPT backend surface,
  read with pi's stored `openai-codex` credential (exported
  `readStoredCredential`) and its `rate_limit.primary_window/secondary_window`
  fields (`used_percent`, `limit_window_seconds`, `reset_at`). The token is
  never refreshed there: refresh tokens rotate, so a footer refresh racing pi's
  would invalidate the login; an expired credential or failed read only drops
  the segments. *Re-verify:* segments missing on a live turn with a fresh
  login — check the response shape, not the parser. *Pin:*
  `stability.test.mjs` (credential field shape).
- **herdr blocked state** (outside the npm pin, 2026-09-18): herdr's bundled pi
  extension (integration v9, herdr 0.9.1) reports `blocked` only on the
  ref-counted `herdr:blocked` `{ active, label }` bus event, not pi's
  `ui_prompt_*`; `index.mjs` bridges the prompt span to it so plan approval,
  questions and broker confirms raise herdr's needs-input notification.
  *Retire:* re-check when the herdr integrations script re-fires on an upgrade;
  delete the bridge once herdr's extension subscribes to `ui_prompt_*` itself,
  or each prompt counts twice.
