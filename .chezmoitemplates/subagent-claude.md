{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $model := index $root.subagent_tiers.claude $meta.tier -}}
{{- if not $model -}}{{- fail (printf "%s: unknown tier %s" $name $meta.tier) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description | toJson }}
{{- /* no `tools` list grants every tool, Agent included */}}
{{- if hasKey $meta "tools" }}
tools: {{ $meta.tools }}
{{- end }}
model: {{ $model }}
effort: {{ default $root.subagent_effort (get $meta "effort") }}
{{- if get $meta "omit_instructions" }}
omitClaudeMd: true
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict) -}}
