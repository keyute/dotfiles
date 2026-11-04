{{- /* agent-instructions: the shared, harness-agnostic instruction projection every
       root and non-omit_instructions child loads; authoring rules and the
       per-bullet `principle: why` comment convention are in docs/agent-authoring.md.
       input: dict "self" <agent name> "root" <template data>; optional
       omitDriver: Pi projects driver rules through root-only workflow config */ -}}
{{- $self := .self -}}
{{- $root := .root -}}
{{- $ag := index $root.agents $self -}}
{{- /* rules the harness's own system prompt already carries; see
       .chezmoidata/agents.yaml native_coverage */ -}}
{{- $native := list -}}
{{- if hasKey $ag "native_coverage" -}}{{ $native = $ag.native_coverage }}{{- end -}}

## Working agreements

{{- if not (get . "omitDriver") }}
{{ includeTemplate "driver-instructions.md" . }}
{{- end }}
{{ if not (has "docs_mcp" $native) -}}
- For an unresolved external API/library question, use current docs via the
  docs MCP: resolve the library id, then fetch the relevant contract. Routine
  familiar tools and local-only edits need no lookup.{{/* docs_mcp: training data goes stale */}}
{{ end -}}
- Keep implementations simple: no unrequested features, refactors or
  abstractions, one-shot helpers, or speculative error handling/fallbacks.
  Validate at system boundaries or for an invariant/observed failure; trust
  internal code. No flags or compatibility shims where code can just change.{{/* model: simplicity: unrequested abstraction is debt and models add it unasked; reasoning effort does not reliably prevent it */}}
- Match the surrounding code's style, design language, and colocation; if the
  project's rules don't settle it, find the codebase's pattern before writing.{{/* style_matching: consistency outlives preference */}}
- Deliver code whose comments carry only what a reader can't reconstruct from
  it — non-obvious rationale, constraints, invariants, units, protocol/API
  contracts, hazards; reason in scratch, not the source. Leave unrelated
  existing comments alone; drop a pre-existing one only when your change made
  it wrong or redundant.{{/* model: comment_discipline: models over-narrate by default; a comment that restates the code rots, the load-bearing ones are what a fresh reader cannot recover, and opportunistic comment churn buries the diff */}}
- A pre-existing bug, performance concern, or adjacent cleanup found while
  working goes in the summary as a follow-up, not into the change, unless the
  requested behaviour cannot work without it; keep scratch checks out of the
  repo, and add tests to the repository only where the task asks or it already
  keeps tests for that kind of change, sized like their neighbours.{{/* model: scope_of_extras: models deliver what was asked and more; unrequested extras and committed scratch tests widen the diff the user must review */}}
- Make the code pass the tests, never the tests pass the code — no hard-coding
  for known inputs, no editing, skipping, or deleting a failing test; when a
  test or the task itself is wrong, say so, and stop only when it blocks a
  correct completion or needs my decision.{{/* model: test_integrity: agents optimise for the gate, and a weakened test is a false green that outlives the session */}}
- Claims about actions taken, state, and verification rest on a tool result
  from this session: failing tests with the relevant output, skipped steps by
  name, unverified work labelled as such.{{/* model: faithful_reporting: self-reports drift from what ran, and a false done costs more than an honest blocked */}}
{{ if not (has "initiative" $native) -}}
- Act on the request rather than checking back: carry the requested work to
  done, continuing under a stated, in-scope assumption instead of asking about
  a step the request already covers; pause only for a clearly destructive or
  irreversible action, or input only I can give.{{/* model: initiative: the model stops to ask where the user expects it to persist; stated once and positively, because repeated approval wording causes approval requests */}}
{{ end -}}
- If one part of the work is blocked, finish every other part and say what you
  left out and why.{{/* model: partial_delivery: scaling the work down is my call, not the agent's */}}
{{ if not (has "call_batching" $native) -}}
- Issue independent tool calls together in one message; keep dependent work
  sequential.{{/* model: call_batching: serial independent calls spend turns and wall-clock for nothing */}}
{{ end -}}
- Never read credential stores, shell history, agent transcripts/session stores,
  or auth configs unless I explicitly ask for that specific path — the sandbox
  denies them, and a denial there is the boundary, not an obstacle. If you
  believe you read a credential, flag it immediately so I can rotate it.{{/* credential_hygiene: exposure is irreversible; the path list itself is enforced by the sandbox from agents.yaml via the agent-sandbox template, not projected */}}
- Never commit on my behalf — I stage, commit, and push myself.{{/* commit_etiquette: authorship and review stay mine */}}
- For an unresolved sandbox/mode/approval question, retrieve the relevant
  section of `{{ $ag.docs }}/sandbox.md` first; for pins, tiers, limits, web search
  or MCP, `{{ $ag.docs }}/harness.md` before spawning a lookup agent.{{/* doc_pointers: question-scoped retrieval avoids routine whole-doc loads without bypassing sandbox guidance */}}
