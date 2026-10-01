# Pi coupling inventory

The undocumented pi and plugin surfaces the managed workflow leans on
(`docs/pi-design.md` rule 7); `npm run test:pi` is the gate on every pin bump
and a pin's claim string holds the mechanics. Each entry names the seam, its
why, any accepted residual, *On red:* (a failing pin on a bump: **repair** the
seam, or **fall back** to the named native surface, deleting the owned one and
accepting the named loss), *Retire:* where known, and its *Pin:* tests. An
entry's part outside the npm pin cannot go red and carries *Re-verify:*; a new
owned surface states its *On red:* when it lands. Source pins name shipped
files: pi-subagents compiled `src/**/*.js` plus `.d.ts`, pi-web-search `.ts`,
and pi's modular `dist/**` — the CLI runs `dist/bundle/cli.js` built from the
same source, so a bundle-only change passes the pins; the bundled-entry test
in `skill-display.test.mjs` is the one check on the code the TUI executes.

- **Shutdown ordering**: detached-run cleanup assumes the root shutdown hook
  precedes pi-subagents' RPC disposal, headless included, and counts only
  observed completion — unaccounted active work is failure, a capped history
  alone is not. *On red:* repair. *Pin:* `fleet.test.mjs`,
  `integration.test.mjs` (ordering, evidence); `stability.test.mjs` (imports,
  `on()` overloads and API members in the shipped declarations).
- **Plugin tool Proxy** (`plugin-api.mjs` `pluginApi`): pi-subagents,
  pi-web-search and pi's own MCP factory get a Proxy of the extension API whose
  `registerTool` swaps the renderers of `subagent`, `bg_wait`, the supervisor
  channel, `mcp__*` and `web_search`, and replaces the schema and description
  of `subagent`; executors are kept. *Why:* rules 2 and 10 for plugin tools,
  and the model sees only calls the `tool_call` hook admits. *On red:* repair —
  the TUI's plugin rows and the quiet completion notice ride it. *Retire:* the
  `subagent` override when the plugin exposes a description option that can
  omit disabled workflow APIs and their guidance. *Pin:* `stability.test.mjs`,
  `plugin-api.test.mjs`, `integration.test.mjs`, `render.test.mjs`.
- **Native MCP wiring**: `createMcpExtension` and `createToolSearchExtension`
  are exported and documented for SDK resource loaders; the workflow calls them
  inside its own factory, on the Proxy, in the root and in every child shim.
  The MCP gate takes a call's server and tool from the definition's
  `server/tool` label recorded at registration, never from the sanitised name,
  and the three resource tools are registered hidden. The gate checks the
  server by name, resting on the supplied `loadConfig` replacing pi's
  `mcp.json` read; that and `/mcp` saving no extension-scoped server are typed,
  documented options. *Why:* `docs/pi-implementation.md`, Decisions.
  *Residual:* a child whose named MCP tool has not registered by `agent_start`
  fails its launch; another loaded extension calling `pi.registerMcpServer()`
  adds a server outside the managed config. *On red:* repair. *Pin:*
  `stability.test.mjs`, `plugin-api.test.mjs`, `integration.test.mjs`.
- **Acceptance and mutation names**: read-only roles declare
  `acceptanceRole: read-only`, write roles `acceptance: {"level":"none",…}`,
  with `mutationTools` naming the `workspace_*` mutators (plus `subagent` where
  they nest). *Why:* pi-subagents infers acceptance from `acceptanceRole` alone
  — `writer` adds a review by its bundled `reviewer` outside the tier policy,
  an omitted role an attestation section — and cannot see renamed tools; the
  driver verifies from the diff. *On red:*
  repair. *Pin:* `stability.test.mjs`.
- **Repair-only seams** (*On red:* repair; each pin's claim holds the
  mechanics): the quiet completion notice (rule 4), session surfaces
  re-applied on `session_start` (rule 8), Tab completion in command arguments
  (rule 5), inline dialog text (rule 11), the fold handle's mouse dispatch
  (rule 2), row spacing for empty self-shelled rows (rule 8), srt's
  `CLAUDE_CODE_TMPDIR`, the plugin data the rows and policy read, the
  pi-subagents config keys and frontmatter flags the roster sets,
  `modelRegistry` members and stream options, the `McpExposure` union, the
  `project_context` split `/usage` reads, the `commands`→`prompts` migration,
  the built-in tool guidelines `GUIDELINES` mirrors, and the bridge guard's
  path normalisation. *Pin:* `stability.test.mjs`; inline dialog text in
  `plan-approval.test.mjs`.
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
- **Editor render shape**: exported but undocumented `renderDiff` and
  `getMarkdownTheme`; `CustomEditor`'s render shape (borders, `setPaddingX`,
  first-line padding) and the Editor internals shell mode uses for its atomic
  prefix. *Why:* rule 5's composer and shell-mode prompt. *On red:* repair.
  *Retire:* when pi exposes a shell-mode/prompt-prefix editor API. *Pin:*
  `stability.test.mjs`, `caret.test.mjs`, real-editor tests.
- **The owned `!` block**: `CaretEditor` intercepts the `onSubmit` pi assigns
  to a custom editor, parses `!`/`!!` as pi's branch does so
  `handleBashCommand` never runs, and runs the command through
  `createLocalBashOperations` with pi's `shellPath`/`shellCommandPrefix`, gated
  on `isProjectTrusted()` so an untrusted checkout cannot pick the shell, and
  wraps the command in an `eval` after the prefix so rc aliases expand.
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
  rules 4 and 6. *On red:* repair. *Retire:* none upstream — pi-subagents'
  fleet status DTO never exposes run, async or tool IDs by design
  (`docs/extension-api.md`, Fleet status DTO). *Pin:* `fleet.test.mjs`,
  `stability.test.mjs`.
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
  `thinking` blocks; rests on every draw passing through it. *Why:* rule 2's
  "takes no space" (earendil-works/pi#8154). *On red:* set `hideThinkingBlock:
  true` in modify_settings; lost: "takes no space" — pi's label, its spacer and
  click region return. *Retire:* when pi can hide reasoning outright. *Pin:*
  `stability.test.mjs`, `rows.test.mjs`, `transcript.test.mjs`.
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
  so dialogs raise herdr's needs-input notification. pi-subagents' own herdr
  bridge (`integrations/herdr-status.js`, on under `HERDR_ENV=1`) raises
  `herdr:busy`/`herdr:blocked` on the same counted bus and reports pane labels
  through `herdr pane report-metadata` while children run. *Re-verify:* when the
  herdr integrations script re-fires on an upgrade, together with the herdr
  hook mirror in `private_dot_claude/settings.json.tmpl`. *Retire:* once
  herdr's extension subscribes to `ui_prompt_*` itself, or each prompt counts
  twice.
