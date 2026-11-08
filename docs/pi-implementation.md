# Pi implementation working record

Architecture decisions behind the managed pi setup and their triggers; model, role and setting decisions are in `docs/decisions.md`.

## Decisions

- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers except Playwright also use SRT
  workers.
- Root Unix-socket broker owns mode, approvals and process leases (owned code:
  re-check when a pi release ships per-tool approval or a policy hook API).
  A lease's network allowlist is the shared list plus that lease's own hosts:
  an MCP server's `domains`, or a reviewed command's `allowed_domains` (Claude
  Code's per-command list), which its single-use ticket carries to one process.
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
- Prompt assembly keeps shared/project policy in native context files. The
  root requires nonempty `workflow.json.driverInstructions` and adds it only
  through `before_agent_start`'s `sections.driver`; children delete that section,
  including when inherited. Registered declaration budgets cover unchanged
  SDK/owned tool text separately from static rendered policy; estimates use
  characters / 4, not a vendor tokenizer.
- Approval accounting uses only public root `pi.appendEntry` custom records,
  outside model context. Each auto review records the filter's metadata, and the
  judge's when the filter did not allow. Only stage/provider/model/effort,
  numeric usage, duration and enum outcomes persist; no action, history, output,
  reason or arbitrary provider metadata. Failed persistence cannot change the
  verdict. A captured session ID and shutdown guard discard late results rather
  than writing them to a replacement session; the public current-session append
  API cannot persist such results back into a departed session. No shutdown wait
  is added to an approval dialog. Revisit if Pi adds session-bound append.
  `/usage` separates approvals from Main (which still includes summaries) and
  workers. Owned workflow children keep the full reported pi-subagents usage
  in their existing run records and every details snapshot, including failures,
  stops and recovered launches; no new ledger or artifact scraping is used.
  `/usage` deduplicates child `runId` across owned custom entries, completion
  messages and orchestrate tool results. Workflows remains available without
  the native cost RPC; recorded known usage wins over a matching native child,
  removed from Subagents so it is charged once. Native known usage fills a
  matching owned snapshot that lacks usage, still counted only in Workflows.
  Late usage after an emitted outcome persists a silent full snapshot in the
  same `workflow-orchestrate` custom-entry type, without another model message,
  wake or fold boundary; shutdown and session-generation guards still apply.
  Missing historical/unfinished usage is unavailable, not zero; a refusal
  before spawn has no charged run.
  Native Subagents remains scoped to the current branch and available artifacts,
  a lower bound that can omit spend when artifacts are missing. Revisit if the
  plugin cost report accounts for owned RPC launches durably across branches.
  Cache counts observed hit/no-cache-read requests separately from Uncached
  tokens. Breaks and its token shortfall are estimates using the existing
  1,024-token ancestor comparison and provider/model/compaction boundaries;
  elapsed time never establishes cache expiry or a miss.
  The offline report includes approval-stage and web-fetch operation
  subtotals while retaining response/stream deduplication. Historical fetch
  records have no answering model ID and are labelled unknown-summary-model,
  never attributed to the driver's model. Plugin searches without usage are
  unmetered, not zero-token requests. Dollars are catalog estimates, not plan
  allowance or cash paid; absent usage is unknown.
- Security claim is scoped: effects and subprocess execution are sandboxed;
  path probes, diff generation, and output temp files stay host-side.
- pi-subagents retains its executor; the existing registration proxy owns
  presentation, the owned schema and managed description. Launch
  policy stays in `tool_call` and broker leases. pi-subagents' scripts stay off
  (`workflow-scripts` in `disabledFeatures`): its workflow launches have no
  per-launch host veto through which to enforce managed admission. Its
  realm-escape fix does not replace that check. The cost is that a nesting
  child's plugin-built description names the legacy `chain`/`tasks` inputs
  its hook strips.
  Arbitrary management stays disabled; `list`, named launches and lifecycle
  controls remain enabled.
  In `extensions/subagent/config.json`, `fleetView`/`asyncWidget` are off
  because the owned fleet (rule 6) replaces them, and `intercomBridge` is off
  so children report only through their completion, as Claude Code's
  subagents do.
  `artifactDir` is `temp`: a child report past 2,000 characters is cut to a
  pointer at its artifact file, and the default session directory sits under
  `~/.pi/agent/sessions`, which the root may not read (`project` would write
  `.pi/subagents` into every repo).
  `toolActivation` is `eager`, so the plugin's lazy `subagents_enable` loader
  is never registered on any launch path: it would re-add itself to the active
  tools every turn, the managed tool refresh would remove it, and pi-ai
  resends the full tool list after any removal. `disabledFeatures` makes
  calls to plugin features the workflow never uses fail, and drops them from a
  nesting child's own `subagent` description (built from this config, not
  replaced by the root proxy).
  The refusing `contact_supervisor` the plugin registers at the root stays
  undeclared there (not in `rootTools`).
  Re-judge when Pi ships native subagents.
- Model workflow scripts run only through the owned `orchestrate` runner: the
  plugin's `runs.run` children skip `checkChildLaunch`; its sandbox does not
  supply a host admission hook. pi-codemode's QuickJS VM isolates scripts
  (only `agent` and `log` reachable, every argument validated host-side).
  Each `agent()` passes
  `checkChildLaunch`, then launches through the plugin's RPC `spawn`. The tool
  call admits one background workflow and returns its ID. The same owner retains
  its VM, children and bounded terminal results, with nonblocking status/result
  and explicit stop; root steering does not rewrite script state. One live owner
  preserves the former serialization limit, including unverified cleanup. Root
  abort and approval do not cancel it; a return to plan mode, `/remove-dir`,
  a session transition and shutdown do. A
  generation-bound finalizer records one outcome and sends the existing hidden
  completion/wake pattern before releasing liveness. No-child workflows count
  as work too. Results do not stand in for child process-exit proof.
  The plugin Proxy consumes wholly owned child notices in busy, idle and held
  states. Its pinned adapter captures the pre-reservation state through the
  plugin-bound context, validates the direct custom-message transaction before
  claiming ownership, restores a consumed idle reservation synchronously and
  removes exact consumed notification bookkeeping after native post-send
  handling. Mixed/unowned
  batches pass through; changed private state falls back to forwarding, not
  swallowing notifications. Ownership starts at the spawn alias, before a reply
  can lag its completion. Retire this adapter when pi-subagents offers a public
  consumed-completion seam. A `tier`
  override may name any non-frontier tier, enforced in `checkChildLaunch` and
  the child-side managed-run guard. Children may call `structured_output`: its
  capture file is a harness artifact write, not a workspace effect, so every
  child workspace write stays broker-authorized. Structured delegation stays
  unusable: an in-process foreground child's shim would replace the root's
  managed-run guard. No journal or resume (trigger: a late-failing workflow
  re-run from scratch twice → a write-ahead journal on `sandbox.start()`) and
  no worktree isolation (trigger: a need for parallel writers → worktrees need
  their own boundary). Reversal trigger: pi-subagents gains a per-launch host
  policy hook, with equivalent cancellation and process-exit ownership → move
  to its sandboxed engine and delete `orchestrate.mjs`.
- Owned OSC 7501 reports the TUI root's run and one record per live child
  and workflow, in Claude Code's shape (rule 4); Rex renders it natively.
  The launcher sets `PI_PROGRAM_STATUS=0`, which keeps pi's native root
  reporter and pi-subagents' per-job reporter (finished jobs left as
  done/error, owned workflows unknown) from writing competing records; with
  it pi-tui sends no query of its own, so the owned reporter queries and
  reads the reply itself. pi-tui's `formatProgramStatus` carries neither
  `id` nor `title`, so the records are encoded in `program-status.mjs`.
  Reversal trigger: pi-tui exports multi-record formatting and its support
  state, or native status covers background work.
- MCP is pi's own, fed the managed servers. Accepted: a connect per server per session and per child; another extension's `pi.registerMcpServer()` adds an unmanaged server. Reversal trigger: children regularly fail their launch on a slow server connect → own the child launcher, or give children fail-soft MCP.
- `web_fetch` is owned and runs in the pi process, outside SRT, as Claude Code's WebFetch runs outside its Bash sandbox: it reaches public hosts only (the address check sits in the connection's DNS lookup, so an answer cannot change between check and connect), and has the search-tier model answer from the page as untrusted data. It needs no broker action: no file or process effect. Not adopted: pi-web-access has the same fetch, but two of its four tools would be used, its per-call `proxy` and `workflow` parameters cannot be switched off, and it moves Exa outside SRT; OpenAI's hosted search only may open a URL named in the prompt. Reversal trigger: a maintained plugin's fetch fits with a one-line seam → adopt it, delete `web_fetch` and its three packages.
- Nesting roles use upstream blocking `bg_wait`, not a custom wake runtime; the `timeoutMs` backstop with its `checkpointBeforeDeadlineMs` steer (`extensions/subagent/config.json`) replaces the 30-minute cutoff. Revisit when upstream delivers completion-triggered turns to headless children.
- `toolDescriptionMode` is `compact`: any explicit mode drops the plugin's
  `promptSnippet`, which teaches workflow calls; the managed description
  replaces its safety guidance.
- Modes are plan and execute, switched by `/plan`, `/execute`, `submit_plan`
  approval or Shift+Tab (Claude Code's one key; pi's native binding there
  cycled the thinking level this repo manages).
  Approval is the auto classifier: the `/approvals` ask mode was removed as a
  simplification, and its confirm dialog stays as the fallback for a classifier
  `ask` or error and for the denial override (reversal trigger: an observed
  false allow the classifier row's re-judge step cannot fix). Children
  start fresh; the fork launch was removed (reversal trigger: a task where a
  child must reason over the root's own reads).
- Approval and `/execute` from plan keep running read-only work; a narrowing
  (return to plan mode, `/remove-dir`), a session change and shutdown stop detached children through
  session-owned RPC and require observed process-terminal proof, not a
  completion notification. Unverified cleanup blocks mode changes; shutdown
  still closes the broker and reports cleanup failures, and shutdown child
  results cannot trigger a model turn. The close hook silently stops shell
  tasks; cleanup retains their outputs and failures. Cleanup cannot run after
  Pi receives SIGKILL, nor does it cover deliberately detached `setsid` daemons
  or external services/containers.

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
