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
---
name: {{ $name }}
description: {{ $meta.description }}
tools: {{ $meta.tools }}
model: {{ if eq $meta.tier "inherit" }}inherit{{ else }}{{ index $root.subagent_tiers.claude $meta.tier }}{{ end }}
effort: {{ $meta.reasoning_effort }}
---

{{ includeTemplate (printf "subagents/%s.md" $name) (dict "instructions_file" "CLAUDE.md") -}}
