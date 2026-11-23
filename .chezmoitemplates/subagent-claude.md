{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $role := get (includeTemplate "roles" (dict "root" $root "harness" "claude") | fromJson) $name -}}
{{- if not $role -}}{{- fail (printf "%s: not in the roster" $name) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description | toJson }}
{{- /* no `tools` list grants every tool, Agent included */}}
{{- if hasKey $meta "tools" }}
tools: {{ $meta.tools }}
{{- end }}
model: {{ $role.model }}
effort: {{ $role.effort }}
{{- if get $meta "omit_instructions" }}
omitClaudeMd: true
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict) -}}
