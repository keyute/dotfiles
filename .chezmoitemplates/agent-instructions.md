{{- /* agent-instructions: portable, harness-agnostic instruction preamble.
       Keep this file free of harness/product-specific pointers — those belong in
       the consumer template (e.g. CLAUDE.md.tmpl). It renders for any agent or
       harness (Claude Code, Codex, ...).
       input: dict "self" <agent name> "root" <template data> */ -}}
{{- $self := .self -}}
{{- $root := .root -}}
{{- $sensitivePaths := list -}}
{{- range $path, $mode := $root.agent_sandbox.filesystem.paths -}}
{{- if eq $mode "none" -}}
{{- $sensitivePaths = append $sensitivePaths $path -}}
{{- end -}}
{{- end -}}
{{- range $name, $agent := $root.agents -}}
{{- if ne $name $self -}}
{{- $sensitivePaths = append $sensitivePaths $agent.home -}}
{{- else -}}
{{- range $agent.sensitive_subpaths -}}
{{- $sensitivePaths = append $sensitivePaths (printf "%s/%s" $agent.home .) -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- $formatted := list -}}
{{- range $sensitivePaths | sortAlpha -}}
{{- $formatted = append $formatted (printf "`%s`" .) -}}
{{- end -}}

## Orchestration & context discipline

Keep your context clean from turn one — do not wait until it fills; by the time the
window is nearly full, degradation has already set in.

- Route disposable work — searches, whole-file reads, log/dependency triage,
  independent research: anything whose intermediate output you won't re-read — to a
  subagent or out to files, so only distilled results enter your context.
- The gate is cost, not fullness. Delegate wherever it keeps context clean, UNLESS
  the handoff costs more than it saves: trivial tasks, sequential work where each step
  needs the previous step's full output, or edits where you must see the exact lines
  you change. Spawn-up costs tokens and latency — it must pay for itself.
- Backstop: if you are still nearing your limit, persist your plan, decisions, and
  open threads to a durable file (memory / plan file / scratchpad) so a fresh session
  resumes with zero loss. Judge "near" as a fraction of your window, not a fixed token
  count (holds at ~200k or ~1M).
- Every delegation is a contract; state all four or the worker drifts: (1) objective,
  (2) scope and boundaries, (3) which files/paths/tools, (4) output format — a
  compressed summary, never a raw dump.
- Scale fan-out to complexity: one worker for a simple lookup; 2–4 in parallel for
  independent strands (spawn together, not serially); more only for broad research.
  Keep each worker's scope smaller than the root task.
- Match a worker's model tier by total tokens-to-done, not sticker price — the
  cheapest tier that one-shots it: smallest for mechanical lookups and simple
  transforms, mid for routine implementation and review, top only for architecture or
  expensive-if-wrong work.

## Working agreements

- Use the configured docs MCP (e.g. context7) for code generation, setup or
  configuration steps, or library/API docs — resolve the library id and fetch the
  docs without me having to ask.
- Use Playwright for frontend interaction, inspection, and screenshots, not as a
  web-search substitute.
- Keep implementations simple; do not overengineer.
- When writing code, match the surrounding code's style, design language, and
  colocation of similar patterns. If the project's own rules don't settle it,
  analyse the codebase to find the pattern before you write.
- For a bugfix where the project has tests wired up: first learn how the project
  writes tests, then if a test is simple and meaningful, write one that reproduces
  the bug, confirm it fails, fix the bug, and rerun to confirm it passes. Keep
  tests minimal and meaningful — no unnecessary cases.
- When I correct your approach or re-explain a convention, offer to record it in the
  project's AGENTS.md (or instructions file) or your memory so it needn't be
  re-explained next session.
- Never read credential stores, shell history, agent transcripts/session stores, or
  auth config paths such as {{ join ", " $formatted }}, or similar sensitive paths,
  unless I explicitly ask for that specific path. If you believe you read a
  credential, flag it immediately so I can rotate it.
- Chezmoi may resolve secret references into private target configs. Keep resolved
  values out of the source repo and never inspect or print those target files.
- Never commit on my behalf — I stage, commit, and push myself.
