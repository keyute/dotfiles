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
- When writing code, always consider code style, implementation, design language and code colocation of similar patterns.
  If the project's CLAUDE.md rules are not sufficient to determine this, you must analyse the codebase to understand
  the specific pattern you must use for your implementation.
- Do not read or inspect credential stores, shell history, agent transcripts/session stores, or auth config paths such as {{ join ", " $formatted }}, or similar sensitive paths unless the user explicitly asks for that specific path.
- If you believe that you had access and read any credentials, you are to flag it so that I can rotate it immediately.
