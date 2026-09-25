{{- /* subagent-pi: render a shared subagent as a pi agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       role contract from the `pi-roles` template, the body from
       .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
{{- $role := get (includeTemplate "pi-roles" (dict "root" $root) | fromJson) $name -}}
{{- if not $role -}}{{- fail (printf "%s: not in the roster, or scoped to another harness" $name) -}}{{- end -}}
---
name: {{ $name }}
description: {{ $meta.description | toJson }}
model: {{ $role.model }}
thinking: {{ $role.thinking }}
tools: {{ join ", " $role.tools }}
extensions: {{ $role.extensionPath }}
inheritProjectContext: true
inheritGlobalContext: true
inheritSkills: true
allowNestedSubagents: {{ $role.nests }}
{{ if $role.readonly }}acceptanceRole: read-only{{ else }}mutationTools: {{ join ", " $role.mutationTools }}
acceptance: {"level":"none","reason":"the driver verifies each slice from its diff and gate"}{{ end }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict "instructions_file" "AGENTS.md") -}}
