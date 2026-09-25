{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := get $root.subagents $name -}}
{{- if not $meta -}}{{- fail (printf "%s: not in the subagents roster" $name) -}}{{- end -}}
{{- $role := get (includeTemplate "claude-roles" (dict "root" $root) | fromJson) $name -}}
{{- if not $role -}}{{- fail (printf "%s: scoped to %v, not claude" $name $meta.harnesses) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description }}
{{- /* a nesting role gets every tool, Agent included, by omitting `tools`;
       the roster's list is pi's translation input */}}
{{- if not (get $meta "nests") }}
tools: {{ $meta.tools }}
{{- end }}
model: {{ $role.model }}
{{- if $role.effort }}
effort: {{ $role.effort }}
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict "instructions_file" "CLAUDE.md") -}}
