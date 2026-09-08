{{- /* agent-instructions: portable, harness-agnostic instruction preamble.
       Keep this file free of harness/product-specific pointers — those belong in
       the consumer template (e.g. CLAUDE.md.tmpl). It renders for any agent or
       harness (Claude Code, Codex, ...).
       input: dict "self" <agent name> "root" <template data> */ -}}
{{- $self := .self -}}
{{- $root := .root -}}
{{- /* the sensitive-path prose reuses agent-sandbox's denyRead so it can never
       drift from the sandbox policy actually enforced for this agent */ -}}
{{- $sb := includeTemplate "agent-sandbox" (dict "self" $self "root" $root) | fromJson -}}
{{- $formatted := list -}}
{{- range $sb.denyRead | sortAlpha -}}
{{- $formatted = append $formatted (printf "`%s`" .) -}}
{{- end -}}

## Working agreements

{{/* Fleet instructions require a configured model-tier mapping. */ -}}
{{ if hasKey $root.subagent_tiers $self -}}
- Delegate bounded, independent work that repays the handoff — disposable
  searches, log triage, research, and spec-complete leaf implementation with an
  objective correctness gate; state objective, scope, files/tools, and output
  format, and take back a distilled summary, never a raw dump. Verify delegated
  writes by reading the actual diff, never the worker's summary. Keep inline
  trivial tasks, tightly sequential steps, and changes whose details must stay
  in your context.
- Spawn independent strands together, scaled to the task's breadth; never hand
  one worker the whole problem.
{{ if not (and (hasKey (index $root.agents $self) "native_delegation_wait") (index $root.agents $self).native_delegation_wait) -}}
- Once you have launched subagents, their scope is off-limits: do only work
  outside it, then end the turn or wait for their results; read a report before
  deciding whether a finding needs your own check.
{{ end -}}
- For unpinned subagents, pick the lowest tier likely to one-shot the task —
  small for bounded mechanical/read-heavy work, mid for routine implementation
  and review, top for hard synthesis or expensive-to-reverse calls; escalate on
  observed failure, not by default. The subagents in `{{ default (printf "%s/agents" (index $root.agents $self).home) (get (index $root.agents $self) "agents_dir") }}` are
  already pinned and the dispatch-time list does not show it — pass a model
  override to one only to escalate it after an observed failure.
- Use the docs MCP (e.g. context7) for code generation, setup/config steps, or
  library/API docs — resolve the library id and fetch unprompted.
- Use Playwright for frontend interaction, inspection, and screenshots — not as a
  web-search substitute.
{{ if and (hasKey (index $root.agents $self) "native_web_search") (not (index $root.agents $self).native_web_search) -}}
- Use the Exa MCP for web search and fetching; no native web-search tool is configured.
{{ else -}}
- Web search: built-in by default (cost); escalate to the Exa MCP when built-in
  results are sparse, stale, or can't reach the source.
{{ end -}}
{{ end -}}
- Keep implementations simple — the simplest thing that works: no features,
  refactors, or abstractions beyond the task, no helpers for one-shot
  operations, no speculative error handling, fallbacks, or validation without a
  boundary, invariant, or observed failure to justify it (validate at system
  boundaries, trust internal code), and no feature flags or compatibility shims
  where the code can just change.
- Match the surrounding code's style, design language, and colocation; if the
  project's rules don't settle it, find the codebase's pattern before writing.
- Edit a file surgically when the result is the same; rewrite a whole file only
  when the change needs it.
- Deliver code whose comments carry only what a reader can't reconstruct from
  it — non-obvious rationale, constraints, invariants, units, protocol/API
  contracts, hazards; strip narration of what the code does, and reason in
  scratch, not the source. Leave unrelated existing comments alone; drop a
  pre-existing one only when your change made it wrong or redundant.
- Bugfix where tests are wired up: learn the project's test style; if a repro
  test is simple and meaningful, write it, see it fail, fix, see it pass. No
  unnecessary cases.
- A pre-existing bug, performance concern, or adjacent cleanup found while
  working goes in the summary as a follow-up, not into the change, unless the
  requested behaviour cannot work without it; keep scratch checks out of the
  repo, and add tests to the repository only where the task asks or it already
  keeps tests for that kind of change, sized like their neighbours.
- Make the code pass the tests, never the tests pass the code — no hard-coding
  for known inputs, no editing, skipping, or deleting a failing test; when a
  test or the task itself is wrong, say so, and stop only when it blocks a
  correct completion or needs my decision.
- Claims about actions taken, state, and verification rest on a tool result
  from this session: failing tests with the relevant output, skipped steps by
  name, unverified work labelled as such.
- When asked to review code, gate only on what makes the change unshippable
  now; an edge case worth fixing only once a real user hits it gets a
  mention in the review — no code comment, no fix until that bug report is
  the task at hand.
{{ if hasKey $root.subagent_tiers $self -}}
- Before calling a change done that no deterministic check (tests, build) gates
  and that will be merged or applied — always for a high-stakes or
  expensive-to-reverse surface: auth, security, data, concurrency, migrations —
  check the artifact against the requirements with a fresh set of eyes: hand a
  fresh-context subagent both, not your reasoning trace, in one pass with no
  follow-up rounds; a cross-model review does not replace it. Skip trivial,
  easily-reverted changes.
{{ end -}}
- When I correct your approach or re-explain a convention, offer to record it in
  the project's instruction file (AGENTS.md/CLAUDE.md) or your memory.
- Never read credential stores, shell history, agent transcripts/session stores,
  or auth config paths such as {{ join ", " $formatted }}, or similar sensitive
  paths, unless I explicitly ask for that specific path. If you believe you read a
  credential, flag it immediately so I can rotate it.
- Never commit on my behalf — I stage, commit, and push myself.
