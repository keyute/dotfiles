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

- Delegate bounded, independent work that repays the handoff — disposable
  searches, log triage, research, and spec-complete leaf implementation with an
  objective correctness gate; state objective, scope, and output format, and
  take back a distilled summary, never a raw dump. Verify delegated writes by
  reading the actual diff, never the worker's summary. Keep inline trivial
  tasks, tightly sequential steps, and changes whose details must stay in your
  context.
- For unpinned subagents, pick the lowest tier likely to one-shot the task —
  small for bounded mechanical/read-heavy work, mid for routine implementation
  and review, top for hard synthesis or expensive-to-reverse calls; escalate on
  observed failure, not by default. The subagents in `{{ (index $root.agents $self).home }}/agents` are
  already pinned and the dispatch-time list does not show it — pass a model
  override to one only to escalate it after an observed failure.
- Use the docs MCP (e.g. context7) for code generation, setup/config steps, or
  library/API docs — resolve the library id and fetch unprompted.
- Use Playwright for frontend interaction, inspection, and screenshots — not as a
  web-search substitute.
- Web search: built-in by default (cost); escalate to the Exa MCP when built-in
  results are sparse, stale, or can't reach the source.
- Keep implementations simple; do not overengineer.
- Match the surrounding code's style, design language, and colocation; if the
  project's rules don't settle it, find the codebase's pattern before writing.
- Deliver code whose comments carry only what a reader can't reconstruct from
  it — non-obvious rationale, constraints, invariants, units, protocol/API
  contracts, hazards; strip narration of what the code does, and reason in
  scratch, not the source. Leave unrelated existing comments alone; drop a
  pre-existing one only when your change made it wrong or redundant.
- Bugfix where tests are wired up: learn the project's test style; if a repro
  test is simple and meaningful, write it, see it fail, fix, see it pass. No
  unnecessary cases.
- When asked to review code, gate only on what makes the change unshippable
  now; an edge case worth fixing only once a real user hits it gets a
  mention in the review — no code comment, no fix until that bug report is
  the task at hand.
- After a high-stakes or expensive-to-reverse change — auth, security, data,
  concurrency, migrations — check the artifact against the requirements with a
  fresh set of eyes before calling it done: hand a subagent both, not your
  reasoning trace. Skip trivial, easily-reverted changes.
- When I correct your approach or re-explain a convention, offer to record it in
  the project's instruction file (AGENTS.md/CLAUDE.md) or your memory.
- Never read credential stores, shell history, agent transcripts/session stores,
  or auth config paths such as {{ join ", " $formatted }}, or similar sensitive
  paths, unless I explicitly ask for that specific path. If you believe you read a
  credential, flag it immediately so I can rotate it.
- Never commit on my behalf — I stage, commit, and push myself.
