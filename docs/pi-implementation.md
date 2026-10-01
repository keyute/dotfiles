# Pi implementation working record

The durable decisions behind the managed pi setup; read before changing its architecture, policy or package pins. Design history
is in git history (`git log -p docs/pi-implementation.md`); model,
role, setting and asymmetry decisions, their evidence and reversal triggers
are in `docs/decisions.md`; architecture decisions and their triggers stay
here.

## Decisions

- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases (owned code:
  re-check when a pi release ships per-tool approval or a policy hook API).
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
- MCP is pi's own, fed the managed servers. Accepted: a connect per server per session and per child; another extension's `pi.registerMcpServer()` adds an unmanaged server. Reversal trigger: children regularly fail their launch on a slow server connect → own the child launcher, or give children fail-soft MCP.
- `web_fetch` is owned and runs in the pi process, outside SRT, as Claude Code's WebFetch runs outside its Bash sandbox: it reaches public hosts only (the address check sits in the connection's DNS lookup, so an answer cannot change between check and connect), returns a cross-host redirect instead of following it, and has the search-tier model answer from the page as untrusted data. It needs no broker action: no file or process effect. Not adopted: pi-web-access has the same fetch, but two of its four tools would be used, its per-call `proxy` and `workflow` parameters cannot be switched off, and it moves Exa outside SRT; OpenAI's hosted search only may open a URL named in the prompt. Reversal trigger: a maintained plugin's fetch fits with a one-line seam → adopt it, delete `web_fetch` and its three packages.
- Nesting roles use upstream blocking `bg_wait`, not a custom wake runtime; the `timeoutMs` backstop with its `checkpointBeforeDeadlineMs` steer (`extensions/subagent/config.json`) replaces the 30-minute cutoff. Revisit when upstream delivers completion-triggered turns to headless children.
- `toolDescriptionMode` is `compact`: any explicit mode drops
  `promptSnippet`/`promptGuidelines` but keeps its fixed safety guidance, which
  the managed description replaces.
  Rejected UI packages: grouping ones patch pi's private components; dialog,
  compact-tool and status-line ones bring their own grammar. Also rejected: chezmoi-native
  settings merge (sprig `mergeOverwrite` skips `false`/`0`; jq's `. * $m` in
  the modify script, as `.claude.json` uses jq, does the merge);
  `modelScope.strict`
  for the tier check (loses refusal text and the frontier rule); dropping the
  double checks on child launch and MCP policy (defence in depth); pooled SRT
  workers, no broker or a one-stage classifier (each recreates leases or changes
  decisions).
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
  escape kill (an orphan after a kill, or a role granted a daemoniser).

## Claude-side bridge internals

- `scripts/pi-bridge.mjs` and `scripts/pi-bridge-guard.mjs`: reversal trigger
  — pi's print mode, tool allowlist or `tool_call` blocking regresses, or
  OpenAI withdraws subscription OAuth for third-party harnesses; then the
  review backend needs a new transport.
