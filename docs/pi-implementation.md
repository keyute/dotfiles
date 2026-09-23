# Pi implementation working record

The durable decisions behind the managed pi setup; read before changing its architecture, policy or package pins. Dated design history through 2026-09-15
is in git history (`git log -p docs/pi-implementation.md`) and, where a
measurement still has an open trigger, in `docs/agents-audit-log.md`.

## Decisions

- The root npm manifest/lockfile is the only Pi install (CLI and SDK are one
  package, pinned exactly); Brew and metapac entries were dropped because they
  cannot declare versions and pi breaks extension APIs across 0.x releases.
  Upgrade as one unit: bump the pin, `npm ci`, `npm run test:pi`, apply.
- OpenAI subscription OAuth only: Luna small, Terra mid, Sol top worker, Astra
  the frontier driver and default (decision 2026-09-15; `children.mjs` rejects
  a child on it). The pinned Pi SDK (see `package.json`) lists Astra; if a
  future pin drops it, report unavailable — do not invent an alias.
- Native host Pi and trusted extensions. The `workspace_*` tools are the SDK's
  own tools running in-host with the real harness context; each invocation
  routes its primitive operations (documented `operations` seam, as pi's
  Gondolin example does) into a per-invocation SRT ops worker. Grep search runs
  wholly inside the worker (the SDK's GrepOperations seam does not cover its
  host-side ripgrep spawn). MCP stdio servers also use SRT workers.
- Root Unix-socket broker owns mode, approvals and process leases (owned code:
  re-check when a pi release ships per-tool approval or a policy hook API,
  2026-09-18). Tool leases
  require a single-use ticket minted at approval, bound to epoch/role/tool.
  Child sessions carry the policy epoch they were launched under (via the
  parent's environment) and are refused if it changed before they connected.
  Known bound: a launch admitted before a transition but spawned after it
  inherits the new epoch — closing that needs a per-launch hook pi-subagents
  does not expose (request upstream if it ever matters); each child write is
  still individually authorized under the current mode, so the residual is
  timing, not an unreviewed write path.
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
  public TUI primitives. Root write/edit schemas are hidden during planning;
  Exa moves behind the existing MCP gateway, while Context7 stays direct.
  These exposure changes leave broker enforcement and child permissions intact.
- 2026-09-22: pi-subagents 0.70.1 removed the completion guard the roles were
  tuned for on 2026-09-18; the driver's diff check is the gate. Roles carry
  `acceptanceRole: read-only` or `acceptance: {"level":"none",…}` with
  `mutationTools` (reasons in `docs/pi-coupling.md`).
- 2026-09-22: keep structured `workflow`/`contextFiles` prompt options, not a
  forced `systemPrompt`. Offline pinned Codex request fixtures preserve initial
  instructions/input for section patches and plan → execute tool additions;
  execute → plan retracts earlier tool declarations, changing the prefix.
  These are request-shape guarantees, not live subscription cache/billing proof.
  No cache plugin or long-TTL override: this Codex builder does not request one.
- 2026-09-22: MCP disables namespace proxies (gateway plus direct Context7 only) and sets `jev: false`; no TypeSafe-key-dependent semantic-search default. `freezeDirectTools: true` trades late direct-tool hot-loading for a stable surface after initialization; the proxy stays live and the initial sync may still notify. Remaining cache-isolation defects and their reversal trigger are in `docs/pi-coupling.md`.
- 2026-09-22: nesting roles use upstream blocking `bg_wait`, not a custom wake runtime; revisit when upstream delivers completion-triggered turns to headless children. The two-hour runtime backstop with a five-minute checkpoint/stop steer replaces the productive run's 30-minute cutoff, not HTTP or auto-drain timeouts (runtime semantics in the harness reference).
- 2026-09-22: no installed-package patches. The upstream Pi proposal is a public bash renderer hook shared by live/replayed blocks: red shell marker, existing transcript indentation, visible streaming output/exit/cancel status, native execution unchanged. Revisit when the hook ships; the native block remains unchanged until then.
- 2026-09-18: TypeSafe Jev is not adopted for the approval classifier. An
  offline replay of 137 reviewed actions plus 16 labelled cases held every
  must-not-allow case at p90 364 ms, but the only slice it fast-allows safely
  (sandboxed reviewed verbs, 11/13 at confidence ≥ 0.7) is 11% of reviews;
  escalations, 89% of them, clear ≥ 0.7 for 5 of 91. Reversal trigger: the
  single-model classifier's per-stage measurement misses its latency target,
  escalations stop dominating, and a fresh replay clears the escalation slice
  with zero wrong allows (audit log 2026-09-18).
- 2026-09-18: the approval classifier runs both stages on Terra, the filter
  at `none` and the judge at `medium`. One model for the whole gate, as Claude
  Code's auto mode and Codex's auto-review both run, keeps model, text and cache
  key aligned, not a guaranteed hit: reasoning changes (clarified 2026-09-22).
  `none` replaces `minimal`, which the 5.6 family lacks and pi-ai
  silently sent as `low`. Terra rather than Luna because the judge's verdict
  is final and OpenAI's own card scores Terra higher on tool-borne and direct
  injection; classifier cost is negligible either way. Fallback, on the live
  per-stage numbers only: a Terra filter median over ~2 s that a Luna probe
  beats moves both stages to Luna (audit log 2026-09-18).
- 2026-09-18: no second model vendor for children. Children are a quarter of
  pi spend and the Terra roles that could move about a sixth; a weaker
  substitute repays its saving through repairs in the Astra context, and no
  Pro limit has been seen binding. Trigger: a weekly limit binds two weeks
  running with children at or above 30% of spend — then trial OpenCode Go
  (pi-validated, $10) on explore-deep alone (audit log 2026-09-18).
- The host copies the settings `editorPaddingX` (default 0) onto custom editors
  right after the factory runs and on settings reloads; `CaretEditor` clamps
  `setPaddingX` to ≥ 2 so the caret's padding columns survive. A `promptPrefix`
  editor option is the right upstream ask.
- Themes come from the data-only `catppuccin-pi-theme` pin, registered by path
  through the managed settings `themes` array (no `pi install`, no extension);
  the `theme` light/dark pair enables pi's terminal-followed auto mode.

## Verification and remaining gates

- Automated tests cover pinned package registration, real child launch preflight,
  policy decisions, shared child capacity, revocation and runner lifecycle.
- Pi and Claude projections pass isolated `chezmoi cat` and `diff` with
  inert secret stubs. No applied credential stores were read.
- The installer and vendored plan mode are removed from source. Obsolete
  targets were removed from the machine directly (2026-09-06) instead of via
  `.chezmoiremove`, which is gone.
- Actual Unix sockets/SRT cannot run in this session (socket binding returns
  EPERM). Socket fixtures skip explicitly; lifecycle-only tests stub the broker. The opt-in live test is
  not evidence of a successful sandbox run until executed on the user's host.
- Live OAuth, foreground/background children, cancellation, the fleet widget and
  MCP remain acceptance gates. Do not treat fixture tests as full DX parity.
- Open residuals and follow-ups (carried from the pruned build log,
  2026-09-15): a timed-out approval does not cancel its queued classifier
  review and a minted ticket is not bound to the reviewed arguments; a
  descendant that leaves the command's process group (`setsid`, double fork)
  or that another user owns escapes the terminal-proof group kill; per-role
  SRT worker pools are the recorded follow-up to per-invocation workers;
  `handlePaste` cancels the completion menu and nothing re-opens it;
  `subagent {action:"list"}` still fires twice a session; `folds.*` grow for
  the session's life and `derive` + `refold` are O(n²) in facts;
  `sandbox-live.test.mjs` fails on a drifted `/denied/` expectation
  (lines 27-28) against the broker's "Writes are disabled in this scope";
  `@hk_net/pi-usage-bars` is the package to read if the `wham/usage` read
  breaks; `forkContext` stays at the full copy because the pruned mode fails
  the launch on any summary error; the fleet rows live in the footer because
  pi's dock order in `chat-viewport.js` is fixed with the footer last.

## Acceptance checks (last verified 2026-09-06; moved here from the runtime harness doc 2026-09-12)

From the source repository, run `npm run test:pi`. It covers policy, classifier
fallback, terminal proof, child preflight and secret-stubbed chezmoi projections.
`PI_WORKFLOW_LIVE_TESTS=1 npm run test:pi` additionally exercises actual Unix
sockets and SRT against disposable fixtures; it needs an unrestricted local host.

Before relying on the setup, separately verify subscription login, parent and
foreground/background child model pins, auto approvals, cancellation, the fleet widget,
MCP queries, diagnostics and approved edits in a disposable project. Fixture
tests do not establish account access or live terminal behavior. The default
moved to Astra on 2026-09-15 on doctrine, not on a matched-task comparison; the
2026-09-09 cost read (same trajectory 2.5x Sol; `docs/agents-audit-log.md`) is
the baseline to measure against.

Do not apply, sign in, stage or commit. Run Claude-side agent-instructions-audit
after these model/harness changes; it is unavailable from a pi session.
