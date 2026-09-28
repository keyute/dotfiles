# Pi implementation working record

The durable decisions behind the managed pi setup; read before changing its architecture, policy or package pins. Dated design history through 2026-09-15
is in git history (`git log -p docs/pi-implementation.md`); model,
role, setting and asymmetry decisions, their evidence and reversal triggers
are in `docs/decisions.md`; architecture decisions and their triggers stay
here.

## Decisions

- The root npm manifest/lockfile is the only Pi install (CLI and SDK are one
  package, pinned exactly); the Brew entry was dropped because it cannot
  declare a version and pi breaks extension APIs across 0.x releases.
  Upgrade as one unit: bump the pin, `npm ci`, `npm run test:pi`, apply
  (lifecycle scripts off). The applied `~/.pi/agent/node_modules` is a symlink
  to that pinned tree, which `workflow/` reaches by parent-directory lookup.
  Settings merge by managed key: pi's `lastChangelogVersion` survives apply, a
  saved theme or `/thinking` level resets, and trust lives in `trust.json`
  (2026-09-26).
- OpenAI subscription OAuth only; tier models live in agents.yaml
  (`subagent_tiers.pi`).
- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases (owned code:
  re-check when a pi release ships per-tool approval or a policy hook API,
  2026-09-18). Its child lease cap is `globalConcurrencyLimit` in
  `extensions/subagent/config.json`, shared with pi-subagents and equal to the
  plugin default; plain JSON cannot say so, and the broker refuses to start
  without it. Tool leases
  require a single-use ticket minted at approval, bound to epoch/role/tool.
  Child sessions carry the policy epoch they were launched under (via the
  parent's environment) and are refused if it changed before they connected.
  Known bound: a launch admitted before a transition but spawned after it
  inherits the new epoch — closing that needs a per-launch hook pi-subagents
  does not expose (request upstream if it ever matters); each child write is
  still individually authorized under the current mode, so the residual is
  timing, not an unreviewed write path.
  A mode change between approval and execution invalidates the lease.
  Child role shims connect to the same live policy. Tools have `workspace_`
  names to prevent native builtins satisfying child allowlists when the policy
  extension fails.
- Security claim is scoped: effects and subprocess execution are sandboxed;
  path probes, diff generation, and output temp files stay host-side.
- Managed zsh launch runs the repo-pinned CLI in fullscreen TUI (mouse
  click-to-expand), disables native tools and ambient extensions, and loads
  workflow plus the existing Herdr lifecycle extension when present.
- pi-subagents retains its executor; the existing registration proxy owns
  presentation, narrowed schema and managed description (2026-09-22). Launch
  policy stays in `tool_call` and broker leases. Scripts/arbitrary management
  stay disabled; `list`, named launches and lifecycle controls remain enabled.
  In `extensions/subagent/config.json`, `fleetView`/`asyncWidget` are off
  because the owned fleet (rule 6) replaces them, `inlineToolDisplay` is
  `summary` because the owned rows (`rows.mjs`) draw subagent calls and fold
  under rule 2, and `intercomBridge` is off so children report only through
  their completion, as Claude Code's subagents do.
  Own launch/status only if coupling rows grow across two consecutive bumps; re-judge when Pi ships native subagents.
  Keep existing plugins and owned UI: catalog alternatives do not remove these policy/presentation seams; reconsider
  adoption when a public API covers them without a wrapper or workaround.
- No agent LSP or semantic-navigation integration (decision 2026-09-17):
  Serena's startup and language-server provisioning add maintenance without a
  demonstrated need. Navigation uses file/search tools; diagnostics use project
  toolchains in `workspace_bash`. Reintroduce only on measured pain.
- No root `@earendil-works/pi-client` pin: pi-subagents 0.70.1 resolves runner
  imports through the host's packages (`runner-aliases.js`, 2026-09-22).
- 2026-09-17: an owned questionnaire replaces RPIV and its dependencies using
  public TUI primitives. Completed decisions keep the question text for the
  classifier; model results omit presentation data. Exa moves behind the
  existing MCP gateway, while Context7 stays direct.
  These exposure changes leave broker enforcement and child permissions intact.
- 2026-09-22: pi-subagents 0.70.1 removed the completion guard the roles were
  tuned for on 2026-09-18; the driver's diff check is the gate. Roles carry
  `acceptanceRole: read-only` or `acceptance: {"level":"none",…}` with
  `mutationTools` (reasons in `docs/pi-coupling.md`). The subagent schema and
  description expose managed keys/APIs only; executor and enforcement are
  unchanged. Nesting children lack the native notifier and collect descendants
  with blocking `bg_wait` before synthesis.
- 2026-09-22: keep structured `workflow`/`contextFiles` prompt options, not a
  forced `systemPrompt`. Offline pinned request fixtures preserve initial
  instructions, input and tools across section patches and mode switches.
  These are request-shape guarantees, not live subscription cache/billing proof.
  No cache plugin or long-TTL override: this request builder does not request one.
- 2026-09-22: MCP disables namespace proxies (gateway plus direct Context7 only) and sets `jev: false`; no TypeSafe-key-dependent semantic-search default. `freezeDirectTools: true` trades late direct-tool hot-loading for a stable surface after initialization. Remaining cache-isolation defects and their reversal trigger are in `docs/pi-coupling.md`.
- 2026-09-22: nesting roles use upstream blocking `bg_wait`, not a custom wake runtime; revisit when upstream delivers completion-triggered turns to headless children. The two-hour runtime backstop with a five-minute checkpoint/stop steer replaces the productive run's 30-minute cutoff, not HTTP or auto-drain timeouts: `bg_wait` window expiry is non-terminal, the separate headless `agent_end` auto-drain keeps its 30-minute limit, and a nesting child collects results during its turn, not through that drain.
- 2026-09-22: no on-disk patches; two guarded prototype replacements (skill display, pending input), pinned in `stability.test.mjs`. The upstream Pi proposal is a public bash renderer hook shared by live/replayed blocks: red shell marker, existing transcript indentation, visible streaming output/exit/cancel status, native execution unchanged. 2026-09-23: rather than wait, the extension owns the `!` round-trip through documented surfaces (composer submit, custom message/entry, its own renderer; `docs/pi-coupling.md`); when the hook ships, hand execution back to pi and keep only the renderer. 2026-09-23, later: the `!` command honours pi's `shellPath`/`shellCommandPrefix` (managed zsh sourcing `~/.zshrc`) through the SDK's `SettingsManager`, so the hand-back changes nothing the user sees.
- 2026-09-24, maintainability survey: keep the owned UI and harness, adopt
  nothing. pi 0.87.1 (latest) has no user-message, pending-input, bash-block or
  prompt-prefix renderer hook (`user_bash` still draws pi's own block; the
  editor-border spinner breaks rule 3; pi#8154 closed not-planned);
  pi-mcp-adapter 2.37.0 has no log-level setting; pi-subagents 0.71.0 keeps
  run ids out of the fleet DTO and appends its safety guidance only in
  `custom` description mode, so `toolDescriptionMode` is `compact` and the
  managed description replaces that fixed text (2026-09-26).
  Grouping packages patch pi's private components; dialog, compact-tool and
  status-line packages bring their own grammar. Also rejected: chezmoi-native
  settings merge (sprig `mergeOverwrite` skips `false`/`0`; 2026-09-26: jq's
  `. * $m` in the modify script, as `.claude.json` uses jq, replaces the owned
  Node merge); `modelScope.strict`
  for the tier check (loses refusal text and the frontier rule); dropping the
  double checks on child launch and MCP policy (defence in depth); pooled SRT
  workers, no broker or a one-stage classifier (each recreates leases or changes
  decisions).
- Settings `defaultThinkingLevel` is the one owner of the root thinking
  level; the workflow sets none per mode (`docs/decisions.md`,
  `setting.pi_defaultThinkingLevel`).
- 2026-09-26: root `workspace_write`/`workspace_edit` stay declared in plan
  mode, reversing 2026-09-17's hiding. After any tool removal pi-ai resends the
  full tool list for the rest of the transcript, so every later mode switch
  re-billed the grown context once, and session start (forced into plan) paid
  it on resume. The broker already refuses a plan-mode write and forwards its
  reason, so the cost is one refused call; Claude Code's plan mode lists
  Edit/Write too. Reversal trigger: refused plan-mode writes outnumber mode
  switches in sessions, or pi-ai stops re-declaring tools after a removal.
- 2026-09-18: the approval classifier also sees the session's recent shell
  commands (the command, whether it ran sandboxed, its exit code; never its
  output), so a retry after a sandboxed failure is judged on that evidence.
- 2026-09-16: mode changes and shutdown stop detached children through
  session-owned RPC and require observed process-terminal proof, not a
  completion notification. Unverified cleanup blocks mode changes; shutdown
  still closes the broker and reports cleanup failures, and shutdown child
  results cannot trigger a model turn. The close hook silently stops shell
  tasks; cleanup retains their outputs and failures. Cleanup cannot run after
  Pi receives SIGKILL, nor does it cover deliberately detached `setsid` daemons
  or external services/containers.
- No `modelOverrides` `contextWindow` raise (`docs/decisions.md`,
  `setting.pi_contextWindow`).
- The workflow's `before_agent_start` hook lists skills to the root model
  through the SDK's `formatSkillsForPrompt`, naming `workspace_read`: pi's own
  listing keys on a tool named `read` or `bash`, and the workflow exposes
  `workspace_*`.
- 2026-09-18: TypeSafe Jev is not adopted for the approval classifier: the
  only slice an offline replay fast-allows safely is the sandboxed reviewed
  verbs, 11% of reviews, and escalations rarely clear the confidence bar.
  Reversal trigger: the single-model classifier's per-stage measurement
  misses its latency target (a filter median over ~2 s), escalations stop
  dominating, and a fresh replay clears the escalation slice with zero wrong
  allows (replay numbers in git history, 2026-09-18).
- The approval classifier's model and efforts: `docs/decisions.md`,
  `agents.pi.defaults.classifier`; filter `off` maps to the model's `none`
  through pi-ai.
- 2026-09-18: no second model vendor for children; a weaker substitute repays
  its saving through repairs in the driver's context (trigger:
  `docs/decisions.md`, `measure.pi_second_vendor`).
- The host copies the settings `editorPaddingX` (default 0) onto custom editors
  right after the factory runs and on settings reloads; `CaretEditor` clamps
  `setPaddingX` to ≥ 2 so the caret's padding columns survive. A `promptPrefix`
  editor option is the right upstream ask.
- Themes come from the data-only `catppuccin-pi-theme` pin, registered by path
  through the managed settings `themes` array (no `pi install`, no extension);
  the `theme` light/dark pair enables pi's terminal-followed auto mode.

## Verification and remaining gates

- `npm run test:pi` covers pinned package registration, policy decisions,
  classifier fallback, terminal proof, child launch preflight and the
  secret-stubbed chezmoi projections; fixtures that need a Unix socket or SRT
  skip where the sandbox denies them.
- `PI_WORKFLOW_LIVE_TESTS=1 npm run test:pi` on an unrestricted host
  exercises actual sockets and SRT against disposable fixtures.
- After a pin bump, re-check live: subscription login, root and child model
  pins, auto approvals, cancellation, the fleet rows and peek, MCP queries.
- Accepted residuals, each with its trigger: a timed-out approval leaves its
  review queued (approval timeouts seen, or a late verdict applied); a ticket
  is bound to epoch/role/tool, not arguments (the approval flow changes, or pi
  lets arguments change post-review); setsid/double-fork/other-user children
  escape kill (an orphan after a kill, or a role granted a daemoniser);
  follow-ups fixed on trigger — paste cancels completions, folds grow,
  forkContext copies in full, fleet rows in the footer, the `wham/usage` read
  (`@hk_net/pi-usage-bars` if it breaks).

## Claude-side bridge internals

- The `pi` MCP entry spawns `scripts/pi-bridge.mjs`, which runs the repo-local
  pi in `--mode json` print mode with the read-only tool allowlist
  (`read,grep,find,ls`), `--no-context-files` and no extensions except the
  bridge's own path guard. `review` embeds a bridge-computed git diff because
  the child cannot run git (decision 2026-09-23).
- MCP transport is kept deliberately: the bridge is harness-spawned outside the
  Bash sandbox (the `~/.pi` deny stays intact) and its rendered per-tool allow
  rules make the tools prompt-free in plan mode. Plan mode
  blocks MCP tools unless allow-listed (`readOnlyHint` ignored; upstream #12368
  closed "not planned") and Bash has no plan-mode exemption.
- Read isolation is the guard extension, not a sandbox: pi's built-in tools run
  in-process, so `scripts/pi-bridge-guard.mjs` rewrites each tool path to the
  vetted canonical path inside `cwd` (which must be a git worktree root) and
  blocks Claude's bare-name `Read()` denies (`.env`) at any depth. Reversal trigger: pi's print mode, tool allowlist or
  `tool_call` blocking regresses, or OpenAI withdraws ChatGPT-subscription
  OAuth from third-party harnesses (sanctioned as of 2026-09-05) — then the
  review backend needs a new transport.
- Subagent model resolution order (since CLI 2.1.251): per-call `model`,
  frontmatter (`inherit` = main conversation), the `CLAUDE_CODE_SUBAGENT_MODEL`
  fallback, main conversation; no managed role uses `inherit`. The
  `Agent(model:…)` deny rule alone guards the per-call path (trialled
  2026-09-27; the hook it superseded is deleted).
- `private_dot_claude/executable_subagent-statusline.js` (owned subagent row):
  reversal trigger — Claude's stock subagent row shows model and effort →
  delete it.
- `scripts/agent-usage.mjs` (owned usage report): reversal trigger — a
  maintained tool reports per-role and per-origin usage from both session
  stores → adopt it.
