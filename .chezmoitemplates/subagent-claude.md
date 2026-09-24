{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data>
       `inherit` is emitted literally, never by omitting `model:` — the two are not
       equivalent; see the subagent model resolution order in
       private_dot_claude/docs/harness.md.tmpl. */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $routing := get $meta "claude" -}}
{{- if not $routing -}}{{- fail (printf "%s: missing Claude routing" $name) -}}{{- end -}}
{{- $tier := get $routing "tier" -}}
{{- if not $tier -}}{{- fail (printf "%s: missing Claude tier" $name) -}}{{- end -}}
{{- $model := "inherit" -}}
{{- if ne $tier "inherit" -}}
  {{- $model = get $root.subagent_tiers.claude $tier -}}
  {{- if not $model -}}{{- fail (printf "%s: unknown Claude tier %s" $name $tier) -}}{{- end -}}
{{- end -}}
{{- $effort := get $routing "reasoning_effort" -}}
{{- if and (ne $model "claude-haiku-4-5") (not $effort) -}}{{- fail (printf "%s: missing Claude effort" $name) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description }}
tools: {{ $meta.tools }}
model: {{ $model }}
{{- if ne $model "claude-haiku-4-5" }}
effort: {{ $effort }}
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict "instructions_file" "CLAUDE.md") -}}
