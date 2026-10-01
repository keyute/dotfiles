{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $role := get (includeTemplate "claude-roles" (dict "root" $root) | fromJson) $name -}}
{{- if not $role -}}{{- fail (printf "%s: not in the roster, or scoped to another harness" $name) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description | toJson }}
{{- /* a nesting role gets every tool, Agent included, by omitting `tools`,
       less the driver_only MCP servers; the roster's list is pi's translation
       input */}}
{{- if not (get $meta "nests") }}
tools: {{ $meta.tools }}
{{- else }}
{{- $driverOnly := list -}}
{{- range $server, $cfg := $root.agent_mcp_servers }}
{{- if get $cfg "driver_only" }}{{ $driverOnly = append $driverOnly (printf "mcp__%s" $server) }}{{ end }}
{{- end }}
{{- if $driverOnly }}
disallowedTools: {{ join ", " $driverOnly }}
{{- end }}
{{- end }}
model: {{ $role.model }}
effort: {{ $role.effort }}
{{- if get $meta "omit_instructions" }}
omitClaudeMd: true
{{- end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict) -}}
