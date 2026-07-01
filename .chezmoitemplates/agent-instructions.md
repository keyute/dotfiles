{{- $sensitivePaths := list -}}
{{- range $path, $mode := .agent_sandbox.filesystem.paths -}}
{{- if eq $mode "none" -}}
{{- $sensitivePaths = append $sensitivePaths $path -}}
{{- end -}}
{{- end -}}
{{- range $name, $agent := .agents -}}
{{- $sensitivePaths = append $sensitivePaths $agent.home -}}
{{- end -}}
{{- $formatted := list -}}
{{- range $sensitivePaths | sortAlpha -}}
{{- $formatted = append $formatted (printf "`%s`" .) -}}
{{- end -}}

- Always use context7 when I need code generation, setup or configuration steps, or
  library/API documentation. This means you should automatically use the Context7 MCP
  tools to resolve library id and get library docs without me having to explicitly ask.
- Always keep your implementation simple, do not overengineer anything
- Delegate to a subagent when a side task would dump output you will not
  reference again into your main context (multi-file searches, reading large
  files end-to-end, dependency/log triage, independent parallel research).
  The subagent burns its own context window and hands you back only a summary.
- Do NOT spawn a subagent when it would not actually save context: trivially
  small tasks, sequential work where each step needs the previous step's full
  output, edits where you must see the exact lines you change, or anything
  you can resolve in one or two tool calls. Subagent spawn-up is not free —
  it costs tokens and latency, so it must pay for itself in context saved.
- Match the subagent's model tier to the task. Use the cheapest tier that
  can do the job correctly: smallest tier for mechanical lookups, file
  discovery, simple transforms; mid tier for routine implementation and
  research; top tier only for architectural reasoning, unfamiliar codebases,
  or work where a wrong answer is expensive. Never default to the top tier
  just because the parent session uses it.
- When writing code, always consider code style, implementation, design language and code colocation of similar patterns.
  If the project's CLAUDE.md rules are not sufficient to determine this, you must analyse the codebase to understand
  the specific pattern you must use for your implementation.
- Do not read or inspect credential stores, shell history, agent transcripts/session stores, or auth config paths such as {{ join ", " $formatted }}, or similar sensitive paths unless the user explicitly asks for that specific path.
- If you believe that you had access and read any credentials, you are to flag it so that I can rotate it immediately.
- If you are doing a bugfix, and the project has testing wired up, you are to understand how tests are written in the
  project first, then evaluate if writing tests is simple and meaningful. If it is, you are to write the tests, then
  validate the bug through the test, then fix the bug, and run the same tests to ensure that the bug is fixed.
- If you are writing a test, ensure that it is minimal and meaningful, do not write test cases that are unnecessary.
