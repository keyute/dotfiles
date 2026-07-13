{{- /* subagent-claude: render a shared subagent as a Claude Code agent file.
       metadata comes from .subagents/<name> in .chezmoidata/agents.yaml, the
       body from .chezmoitemplates/subagents/<name>.md.
       input: dict "name" <subagent name> "root" <template data> */ -}}
{{- $name := .name -}}
{{- $root := .root -}}
{{- $meta := index $root.subagents $name -}}
---
name: {{ $name }}
description: {{ $meta.description }}
tools: {{ $meta.tools }}
model: {{ index $root.subagent_tiers.claude $meta.tier }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict "instructions_file" "CLAUDE.md") -}}
