# Pi implementation working record

The durable decisions behind the managed pi setup; read before changing its architecture, policy or package pins. Design history
is in git history (`git log -p docs/pi-implementation.md`); model,
role, setting and asymmetry decisions, their evidence and reversal triggers
are in `docs/decisions.md`; architecture decisions and their triggers stay
here.

## Decisions

- The root npm manifest/lockfile is the only pi install, pinned exactly
  (`docs/decisions.md`, `parity.cli_versioning`). The applied
  `~/.pi/agent/node_modules` is a symlink to that pinned tree, which
  `workflow/` reaches by parent-directory lookup.
  Settings merge by managed key: pi's `lastChangelogVersion` survives apply, a
  saved theme or `/thinking` level resets, and trust lives in `trust.json`.
- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases (owned code:
  re-check when a pi release ships per-tool approval or a policy hook API). Its child lease cap is
  `agents.pi.child_limit`, rendered into `workflow.json`: one ceiling across
  the tree, owned here rather than read from pi-subagents' config. Tool leases
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
- pi-subagents retains its executor; the existing registration proxy owns
  presentation, narrowed schema and managed description. Launch
  policy stays in `tool_call` and broker leases. Scripts/arbitrary management
  stay disabled; `list`, named launches and lifecycle controls remain enabled.
  In `extensions/subagent/config.json`, `fleetView`/`asyncWidget` are off
  because the owned fleet (rule 6) replaces them, and `intercomBridge` is off
  so children report only through their completion, as Claude Code's
  subagents do.
  The managed launch passes `--exclude-tools subagents_enable`: the plugin's
  lazy loader re-adds itself to the active tools every turn, the managed tool
  refresh removes it, and pi-ai resends the full tool list after any removal.
  Re-judge when Pi ships native subagents.
  Keep existing plugins and owned UI: catalog alternatives do not remove these policy/presentation seams; reconsider
  adoption when a public API covers them without a wrapper or workaround.
- Keep structured `workflow`/`contextFiles` prompt options, not a
  forced `systemPrompt`. Offline pinned request fixtures preserve initial
  instructions, input and tools across section patches and mode switches.
  These are request-shape guarantees, not live subscription cache/billing proof.
  No cache plugin or long-TTL override: this request builder does not request one.
- MCP is pi's own: the workflow calls the exported MCP and tool-search factories with the servers rendered into `workflow.json`, so tools carry Claude Code's `mcp__server__tool` names and the broker reviews each call in `tool_call` (`docs/pi-coupling.md`, Native MCP wiring). No `mcp.json` and no `-e builtin:mcp`: children load no built-ins, and a trusted project's `mcp.json` would outrank a sandboxed server of the same name. pi-mcp-adapter is dropped: its pi-ai peer range stops short of the pinned pi, so installing it needs a peer override. The root reaches every server's tools through `tool_search` (`docs/decisions.md`, `setting.pi_mcp_exposure`); children get their named tools declared. Accepted: a connect per server per session and per child. Reversal trigger: children regularly fail their launch on a slow server connect → own the child launcher, or give children fail-soft MCP.
- `web_fetch` is owned and runs in the pi process, outside SRT, as Claude Code's WebFetch runs outside its Bash sandbox: it reaches public hosts only (the address check sits in the connection's DNS lookup, so an answer cannot change between check and connect), returns a cross-host redirect instead of following it, and has the search-tier model answer from the page as untrusted data. It needs no broker action: no file or process effect. Not adopted: pi-web-access has the same fetch, but two of its four tools would be used, its per-call `proxy` and `workflow` parameters cannot be switched off, and it moves Exa outside SRT; OpenAI's hosted search only may open a URL named in the prompt (`docs/decisions.md`, `parity.web_tools`).
- Nesting roles use upstream blocking `bg_wait`, not a custom wake runtime; revisit when upstream delivers completion-triggered turns to headless children. The `timeoutMs` runtime backstop with its `checkpointBeforeDeadlineMs` checkpoint/stop steer (`extensions/subagent/config.json`) replaces the productive run's 30-minute cutoff, not HTTP or auto-drain timeouts: `bg_wait` window expiry is non-terminal, the separate headless `agent_end` auto-drain keeps its 30-minute limit, and a nesting child collects results during its turn, not through that drain.
- No on-disk patches; three guarded prototype replacements (`docs/pi-coupling.md`: Skill display, Pending input, Hidden reasoning). The extension owns the `!` round-trip, honouring pi's `shellPath`/`shellCommandPrefix` and wrapping the command in an `eval` so the rc's aliases expand. When pi ships a public bash renderer hook shared by live and replayed blocks, hand execution back to pi and keep only the renderer; pi's native `!` would lose that alias expansion (`docs/pi-coupling.md`, The owned `!` block).
- Keep the owned UI and harness, adopt nothing: pi has no user-message,
  pending-input, bash-block or prompt-prefix renderer hook (pi#8154 closed
  not-planned), and pi-subagents keeps run ids out of the fleet DTO.
  `toolDescriptionMode` is `compact`: any explicit mode drops
  `promptSnippet`/`promptGuidelines` but keeps its fixed safety guidance, which
  the managed description replaces.
  Grouping packages patch pi's private components; dialog, compact-tool and
  status-line packages bring their own grammar. Also rejected: chezmoi-native
  settings merge (sprig `mergeOverwrite` skips `false`/`0`; jq's `. * $m` in
  the modify script, as `.claude.json` uses jq, does the merge);
  `modelScope.strict`
  for the tier check (loses refusal text and the frontier rule); dropping the
  double checks on child launch and MCP policy (defence in depth); pooled SRT
  workers, no broker or a one-stage classifier (each recreates leases or changes
  decisions).
- Root `workspace_write`/`workspace_edit` stay declared in plan mode. After
  any tool removal pi-ai resends the
  full tool list for the rest of the transcript, so every later mode switch
  re-billed the grown context once, and session start (forced into plan) paid
  it on resume. The broker already refuses a plan-mode write and forwards its
  reason, so the cost is one refused call; Claude Code's plan mode lists
  Edit/Write too. Reversal trigger: refused plan-mode writes outnumber mode
  switches in sessions, or pi-ai stops re-declaring tools after a removal.
- The approval classifier also sees the session's recent shell
  commands (the command, whether it ran sandboxed, its exit code; never its
  output), so a retry after a sandboxed failure is judged on that evidence.
- Mode changes and shutdown stop detached children through
  session-owned RPC and require observed process-terminal proof, not a
  completion notification. Unverified cleanup blocks mode changes; shutdown
  still closes the broker and reports cleanup failures, and shutdown child
  results cannot trigger a model turn. The close hook silently stops shell
  tasks; cleanup retains their outputs and failures. Cleanup cannot run after
  Pi receives SIGKILL, nor does it cover deliberately detached `setsid` daemons
  or external services/containers.
- TypeSafe Jev is not adopted for the approval classifier: the
  only slice an offline replay fast-allows safely is the sandboxed reviewed
  verbs, 11% of reviews, and escalations rarely clear the confidence bar.
  Reversal trigger: the single-model classifier's per-stage measurement
  misses its latency target (a filter median over ~2 s), escalations stop
  dominating, and a fresh replay clears the escalation slice with zero wrong
  allows (replay numbers in git history).

## Verification and remaining gates

- `PI_WORKFLOW_LIVE_TESTS=1 npm run test:pi` exercises actual sockets and
  SRT against disposable fixtures; the macOS CI job sets it (the agent sandbox
  denies the socket locally). If it cannot go green there, delete the live
  tests and this bullet.
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
  blocks Claude's bare-name `Read()` denies (`.env`) at any depth; for grep it
  owns the `--glob` pi forwards to `rg --hidden` (pinned in `stability.test.mjs`)
  so a directory search excludes those names. Reversal trigger: pi's print mode, tool allowlist or
  `tool_call` blocking regresses, or OpenAI withdraws ChatGPT-subscription
  OAuth from third-party harnesses (sanctioned as of 2026-09-05) — then the
  review backend needs a new transport.
- `private_dot_claude/executable_subagent-statusline.js` (owned subagent row):
  reversal trigger — Claude's stock subagent row shows model and effort →
  delete it.
- `scripts/agent-usage.mjs` (owned usage report): reversal trigger — a
  maintained tool reports per-role and per-origin usage from both session
  stores → adopt it.
  The owned `/usage` command is the per-session view (`docs/pi-design.md`);
  the script stays the cross-session one.
