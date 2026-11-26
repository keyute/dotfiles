{{- /* subagent-kopi: render a shared subagent as a Kopi agent file; metadata from
       .subagents/<name>, the pin from .subagent_tiers.kopi, the body from subagents/<name>.md.
       Kopi stops at start on an unknown field or tool. The name is lowercased:
       the roster's capitals only match Claude's built-ins, and kopi has none.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $model := index $root.subagent_tiers.kopi $meta.tier -}}
{{- if not $model -}}{{- fail (printf "%s: unknown tier %s" $name $meta.tier) -}}{{- end -}}
---
name: {{ $name | lower }}
description: {{ $meta.description | toJson }}
model: {{ $model }}
effort: {{ default $root.subagent_effort (get $meta "effort") }}
{{- /* kopi matches `tools` by exact name, so a wildcard would grant nothing;
       no list grants every child tool. ToolSearch is never listed: a child
       builds its own */}}
{{- if hasKey $meta "tools" }}
tools: [{{ $meta.tools }}]
{{- end }}
{{- if $meta.readonly }}
mode: plan
{{- end }}
{{- if get $meta "omit_instructions" }}
instructions: false
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict) -}}
