{{- /* agent-instructions: the shared, harness-agnostic instruction projection every
       root and non-omit_instructions child loads; authoring rules and the
       per-bullet `principle: why` comment convention are in docs/agent-authoring.md. */ -}}

## Working agreements
- When you are the session driver (the model this session started on, not a
  dispatched worker):
  - Hand implementation to the lowest capable pinned worker once design,
    exclusive scope and objective gate are settled; it owns
    implementation/test/repair, so never redo it. Unblock handoffs; take over
    only when it loops on repair. Verify its writes by diff; adjudicate gate
    evidence; rerun only on changed inputs, missing evidence or concrete doubt.{{/* driver_ownership: every driver turn re-reads the driver's whole context and keeps its results there for the rest of the session, so a settled slice costs less in a cheaper worker's short context even after that worker's cold re-read; delegation buys cost and parallelism, not a better answer. Redoing a child's work pays twice; a recoverable handoff blocker must not transfer ownership to the driver, a repair loop is the one takeover trigger, and an unchanged gate rerun repeats evidence the driver already has */}}
  - Before calling merged/applied work done, use `spec-reviewer` when checks
    do not gate its requirements, and always for auth/security boundaries,
    data loss/migration, concurrency or external contracts. Give artifact,
    requirements, snapshot and green gates; one pass. Re-review fixes only.{{/* self_review: a producing context endorses its own output; iterated rounds add false positives faster than catches. The named role keeps the pass off write-capable or omission-blind reviewers; the skip and fix-scoped re-review keep it off trivial gated work. */}}
  - Act on the request rather than checking back: carry the requested work to
    done, continuing under a stated, in-scope assumption instead of asking about
    a step the request already covers; pause only for a clearly destructive or
    irreversible action, or input only I can give.{{/* initiative: the model stops to ask where the user expects it to persist; stated once and positively, because repeated approval wording causes approval requests */}}
  - Give each Workflow `agent()` its roster `agentType` (no effort). A loop
    over a discovered list spends one agent per item: verify findings in
    batches per group, not one agent per finding.{{/* workflow_burn: cost is agent count x lifetime x read volume; agentType carries the role's tools, body and effort, and on kopi its pin too (Claude's CLAUDE_CODE_WORKFLOW_SUBAGENT_MODEL fixes the model there); on kopi an untyped agent gets every tool and the driver's model */}}
- Keep implementations simple: no unrequested features, refactors or
  abstractions, one-shot helpers, or speculative error handling/fallbacks.
  Validate at system boundaries or for an invariant/observed failure; trust
  internal code. No flags or compatibility shims where code can just change.{{/* simplicity: unrequested abstraction is debt and models add it unasked; reasoning effort does not reliably prevent it */}}
- Match the surrounding code's style, design language, and colocation. Before
  designing a solution, follow a reference point: the project's own pattern,
  else the tool's or library's documentation or an established implementation;
  write a novel approach only when none fits, and say why.{{/* prior_art: a solved problem re-solved from scratch costs review and misses the edge cases the reference already handles; consistency outlives preference */}}
- Deliver code whose comments carry only what a reader can't reconstruct from
  it — non-obvious rationale, constraints, invariants, units, protocol/API
  contracts, hazards; reason in scratch, not the source. Leave unrelated
  existing comments alone; drop a pre-existing one only when your change made
  it wrong or redundant.{{/* comment_discipline: models over-narrate by default; a comment that restates the code rots, the load-bearing ones are what a fresh reader cannot recover, and opportunistic comment churn buries the diff */}}
- A pre-existing bug, performance concern, or adjacent cleanup found while
  working goes in the summary as a follow-up, not into the change, unless the
  requested behaviour cannot work without it; keep scratch checks out of the
  repo, and add tests to the repository only where the task asks or it already
  keeps tests for that kind of change, sized like their neighbours.{{/* scope_of_extras: models deliver what was asked and more; unrequested extras and committed scratch tests widen the diff the user must review */}}
- Make the code pass the tests, never the tests pass the code — no hard-coding
  for known inputs, no editing, skipping, or deleting a failing test; when a
  test or the task itself is wrong, say so, and stop only when it blocks a
  correct completion or needs my decision.{{/* test_integrity: agents optimise for the gate, and a weakened test is a false green that outlives the session */}}
- Claims about actions taken, state, and verification rest on a tool result
  from this session: failing tests with the relevant output, skipped steps by
  name, unverified work labelled as such.{{/* faithful_reporting: self-reports drift from what ran, and a false done costs more than an honest blocked */}}
- If one part of the work is blocked, finish every other part and say what you
  left out and why.{{/* partial_delivery: scaling the work down is my call, not the agent's */}}
- Issue independent tool calls together in one message; keep dependent work
  sequential.{{/* call_batching: serial independent calls spend turns and wall-clock for nothing */}}
- Search and read the web with the built-in tools first; use the Exa MCP only
  after a built-in call for that same need came back sparse, stale, refused or
  empty.{{/* web_tool_order: Exa bills per call, and a server's own instructions argue for itself */}}
- Never read credential stores, shell history, agent transcripts/session stores,
  or auth configs unless I explicitly ask for that specific path — sandbox and
  permission rules deny them, and a denial is the boundary, not an obstacle. If
  you believe you read a credential, flag it immediately so I can rotate it.{{/* credential_hygiene: exposure is irreversible; the path list itself is enforced by the sandbox and permission deny rules from agents.yaml via the agent-sandbox template, not projected */}}
- Never commit on my behalf — I stage, commit, and push myself.{{/* commit_etiquette: authorship and review stay mine */}}
