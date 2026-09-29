# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7); `npm run test:pi` is the gate on every pin bump
and a pin's claim string holds the mechanics. Each entry names the seam, its
why, any accepted residual, *On red:* (a failing pin on a bump: **repair** the
seam, or **fall back** to the named native surface, deleting the owned one and
accepting the named loss), *Retire:* where known, and its *Pin:* tests. An
entry's part outside the npm pin cannot go red and carries *Re-verify:*; a new
owned surface states its *On red:* when it lands. Source pins name shipped
files: pi-subagents compiled `src/**/*.js` plus `.d.ts`, pi-web-search and
pi-mcp-adapter `.ts`.

- **Shutdown ordering**: detached-run cleanup assumes the root shutdown hook
  precedes pi-subagents' RPC disposal, headless included, and counts only
  observed completion — unaccounted active work is failure, a capped history
  alone is not. *On red:* repair. *Pin:* `fleet.test.mjs`,
  `integration.test.mjs` (ordering, evidence); `stability.test.mjs` (imports,
  `on()` overloads and API members in the shipped declarations).
- **Plugin tool Proxy** (`plugin-api.mjs` `pluginApi`): pi-subagents,
  pi-mcp-adapter and pi-web-search get a Proxy of the extension API whose
  `registerTool` swaps the renderers of `subagent`, `bg_wait`, the supervisor
  channel, `mcp`, `mcp__*` and `web_search`, and replaces the schema and
  description of `subagent` and `mcp`; executors are kept. *Why:* rules 2 and 10
  for plugin tools, and the model sees only calls the `tool_call` hook and
  `scriptMode: false` admit. *On red:* repair — the TUI's plugin rows and the
  quiet completion notice ride it. *Retire:* the `subagent` override when the
  plugin exposes a description option that can omit disabled workflow APIs and
  their guidance; the `mcp` override when the adapter exposes an option that
  omits install/auth/UI actions. *Pin:* `stability.test.mjs`,
  `plugin-api.test.mjs`, `integration.test.mjs`, `render.test.mjs`.
- **MCP settings**: public `namespaceProxyTools: false`, `jev: false`,
  `freezeDirectTools: true` (`docs/pi-implementation.md`, Decisions).
  *Residual:* the initial sync may still notify, including on a deferred first
  connection, and proxy metadata stays live; the adapter's shared name-keyed
  cache races and hashes the wrapper rather than the resolved broker
  connection; the adapter's optional `@earendil-works/pi-ai` peer range lags
  the pinned pi-ai. *On red:* repair. *Retire:* when upstream supports
  connection- or instance-scoped metadata storage; re-check the peer lag when
  the adapter widens its range or a pi-ai bump breaks it. *Pin:*
  `mcp-lifecycle.test.mjs` (its cache schema/hash helpers are test-only
  internals).
- **MCP logging**: the adapter's internal `logger.ts` singleton, loaded through
  its own Jiti instance and set to `warn` before installation. *Why:* its `info`
  output drew over the live composer (rule 5). *On red:* repair. *Retire:* when
  the adapter exposes a public logging setting or stops routine terminal
  output. *Pin:* `mcp-lifecycle.test.mjs`, source pins.
- **Acceptance and mutation names**: read-only roles declare
  `acceptanceRole: read-only`, write roles `acceptance: {"level":"none",…}`,
  with `mutationTools` naming the `workspace_*` mutators (plus `subagent` where
  they nest). *Why:* pi-subagents infers acceptance from `acceptanceRole` alone
  — `writer` adds a review by its bundled `reviewer` outside the tier policy,
  an omitted role an attestation section — and cannot see renamed tools; the
  driver verifies from the diff. *On red:*
  repair. *Pin:* `stability.test.mjs`.
- **Quiet completion notice**: the `pluginApi` Proxy intercepts `sendMessage`
  and sends pi-subagents' completion notice with `display` off; during shutdown
  results still reach the transcript with `triggerTurn: false`. *Why:* rule 4.
  *On red:* repair. *Pin:* `stability.test.mjs`, `plugin-api.test.mjs`.
- **Session surfaces**: pi's `resetExtensionUI` (on `/new`, `/resume`) clears
  the header, footer and custom editor, so `session_start` re-applies them.
  *Why:* rule 8. *On red:* repair. *Pin:* `stability.test.mjs`.
- **Skill display**: wraps `InteractiveMode`'s undocumented
  `getUserMessageText` once, turning a native `parseSkillBlock` match back into
  `/skill:name` plus arguments; the host class comes from pi's virtual modules,
  since the bundled CLI and unbundled SDK export different classes. *Why:* rule
  5's single user box. *On red:* fall back to pi's native skill card; lost: the
  single box — the skill shows as a second block with its instruction body.
  *Retire:* when pi exposes a user/skill-message renderer. *Pin:*
  `stability.test.mjs`, bundled-entry and real-render tests.
- **Skill listing**: the root's `before_agent_start` hook fills
  `systemPromptOptions.sections.skills` from the undocumented
  `formatSkillsForPrompt(skills, "read")`, renamed to `workspace_read`. *Why:*
  pi renders `<skills>` only when a tool named `read` or `bash` is active, and
  the workflow exposes only `workspace_*` tools. *On red:* repair — without it
  skills load only by `/skill:name`. *Pin:* `stability.test.mjs`.
- **Pending input**: replaces only `InteractiveMode.updatePendingMessagesDisplay`
  on the same host class; pi keeps queue ownership. *Why:* rule 5, queued
  input. *On red:* fall back to pi's native pending display; lost: the shaded
  `❯` blocks and their `π` labels. *Retire:* when pi offers a pending-input
  renderer. *Pin:* `stability.test.mjs`, render/lifecycle tests.
- **Tab completion**: the documented `addAutocompleteProvider` wrapper
  (`editor.mjs` `argumentCompletions`) and `CaretEditor`'s key re-issue after
  an accept. *Why:* pi
  routes Tab in a command's arguments to forced file completion and nothing
  re-opens the menu after an accept (rule 5). *On red:* repair. *Pin:*
  `stability.test.mjs`, `caret.test.mjs`.
- **Editor render shape**: exported but undocumented `renderDiff` and
  `getMarkdownTheme`; `CustomEditor`'s render shape (borders, `setPaddingX`,
  first-line padding) and the Editor internals shell mode uses for its atomic
  prefix. *Why:* rule 5's composer and shell-mode prompt. *On red:* repair.
  *Retire:* when pi exposes a shell-mode/prompt-prefix editor API. *Pin:*
  `stability.test.mjs`, `caret.test.mjs`, real-editor tests.
- **Inline dialog text**: plan feedback, questionnaire notes and free answers
  keep `Editor.render()` and drop its border rows at one site, `dialog.mjs`'s
  field. *Why:* rule 11's inline text. *On red:* repair. *Pin:*
  `plan-approval.test.mjs`.
- **Mouse**: the fold handle answers clicks from its own `handleMouse`, resting
  on `MouseRegion` asking the child first and `ToolExecutionComponent`
  forwarding self-shell events one row up. Reasoning's transformer returns ""
  so no invisible clickable line renders. *Why:* rule 2's handle. *On red:* repair. *Pin:* `stability.test.mjs`.
- **Row spacing**: `ToolExecutionComponent` renders no line, spacer included,
  for a self-shelled row with no content; a group's hidden members lean on it.
  *Why:* rule 8. *On red:* repair. *Pin:* `stability.test.mjs`,
  `transcript.test.mjs`.
- **The owned `!` block**: `CaretEditor` intercepts the `onSubmit` pi assigns
  to a custom editor, parses `!`/`!!` as pi's branch does so
  `handleBashCommand` never runs, and runs the command through
  `createLocalBashOperations` with pi's `shellPath`/`shellCommandPrefix`, gated
  on `isProjectTrusted()` so an untrusted checkout cannot pick the shell.
  *Why:* rule 5's shell block; pi has no renderer
  hook for its own. *Residual:* no `bash_execution_update`, no full-output file
  on truncation, no pi pending shell component. *On red:* repair. *Retire:*
  when pi exposes a renderer for its shell block or a documented submit hook.
  *Pin:* `stability.test.mjs`.
- **Unified activity groups**: a completion-led group reads the timeline at
  paint time and repaints through the footer's `tui.requestRender()`, since an
  entry renderer gets no invalidate handle; rests on `CustomEntryComponent`'s
  spacer rule, `addCustomEntryToChat` skipping empty entries and `Container`
  click dispatch. *Why:* rule 2. *Residual:* a transcript rebuilt from a branch
  lacking a group's first entry drops that group's later members; two
  completions with a text chunk between them sit adjacent but ungrouped. *On
  red:* repair. *Pin:* `stability.test.mjs`, `transcript.test.mjs`.
- **Fleet run matching heuristic**: fleet rows match active top-level
  named-agent runs by unique exact agent/start time (`fleet.mjs` `runIdFor`);
  ambiguous or missing matches get no control ID and never rebind to a sibling.
  Completion lines read the `subagent:async-complete` payload and take the task
  from the launch's own tool events, since `async-started` redacts it. *Why:*
  rules 4 and 6. *On red:* repair. *Retire:* the heuristic when upstream
  supplies the run ID in the fleet DTO. *Pin:* `fleet.test.mjs`,
  `stability.test.mjs`.
- **Fleet peek replay**: replays `<asyncDir>/events.jsonl`, whose `subagent*`
  record annotations, truncation marker and steer receipts are undocumented;
  after a resume `asyncDir` is read back from the branch's `subagent` results.
  Peek's native editor is shaped at its bottom-border callback. *Why:* rule 6's
  peek. *On red:* repair. *Retire:* each record seam when pi-subagents
  documents the shape or serves it over RPC; the render-shape seam when Editor
  offers a borderless, height-bounded render API. *Pin:* `stability.test.mjs`.
- **srt `CLAUDE_CODE_TMPDIR`**: names the `TMPDIR` srt exports into a wrapped
  command, documented only in srt's source; `sandbox-runner.mjs` sets it to the
  lease's scratch path. *On red:* repair. *Pin:* `sandbox-runner.test.mjs`,
  `stability.test.mjs`.
- **Plugin data the rows and policy read**: pi-web-search's `details.error` and
  its `web_search` name; the SDK bash schema's `properties` map taking the
  `run_in_background` flag. *On red:* repair. *Pin:* `stability.test.mjs`.
- **Working row**: a pi-tui `Loader` subclass docked through `setWidget`'s
  component form above the editor; it stands down for pi's compaction indicator,
  and pi's auto-retry countdown shows alongside it. *Why:* rule 3. *On red:*
  fall back to pi's own working row (`setWorkingVisible` left on); lost: the
  column-0 row with a trailing blank line and the frozen settled-root snapshot.
  *Pin:* `stability.test.mjs`.
- **Blanked reasoning**: `message_end` blanks the thinking text and
  `message_update` swaps blanked copies into the streaming message, gated on
  `message.api`; it rests on pi-ai and pi-agent-core internals. *Why:* rule 2's
  "takes no space" (earendil-works/pi#8154). *On red:* fall back to the
  `assistant-thinking` transformer alone (or `hideThinkingBlock`); lost: pi's
  spacer before a reasoned assistant message returns. *Pin:*
  `stability.test.mjs`.
- **Usage segments** (outside the npm pin): unversioned
  `GET chatgpt.com/backend-api/wham/usage`, read with pi's stored
  `openai-codex` credential (`readStoredCredential`) and its
  `rate_limit.primary_window/secondary_window` fields (`used_percent`,
  `limit_window_seconds`, `reset_at`). The token is never
  refreshed there: refresh tokens rotate, so a refresh racing pi's would
  invalidate the login; a failed read only drops the segments. *Why:* rule 3.
  *Re-verify:* segments missing on a live turn with a fresh login — check the
  response shape, not the parser. *Retire:* for `@hk_net/pi-usage-bars` if the
  endpoint breaks, losing the segments inside rule 3's single status line.
  *On red* (the credential field shape): repair. *Pin:* `stability.test.mjs`.
- **herdr blocked state** (outside the npm pin): herdr's bundled pi extension
  reports `blocked` only on the ref-counted `herdr:blocked` `{ active, label }`
  bus event, not pi's `ui_prompt_*`; `index.mjs` bridges the prompt span to it
  so dialogs raise herdr's needs-input notification. *Re-verify:* when the
  herdr integrations script re-fires on an upgrade, together with the herdr
  hook mirror in `private_dot_claude/settings.json.tmpl`. *Retire:* once
  herdr's extension subscribes to `ui_prompt_*` itself, or each prompt counts
  twice.
