{{- /* agent-instructions: portable, harness-agnostic instruction preamble.
       Keep this file free of harness/product-specific pointers — those belong in
       the consumer template (e.g. CLAUDE.md.tmpl). It renders for any agent or
       harness (Claude Code, Codex, ...).
       input: dict "self" <agent name> "root" <template data> */ -}}
{{- $self := .self -}}
{{- $root := .root -}}
{{- /* the sensitive-path prose reuses agent-sandbox's denyRead so it can never
       drift from the sandbox policy actually enforced for this agent */ -}}
{{- $sb := includeTemplate "agent-sandbox" (dict "self" $self "root" $root) | fromJson -}}
{{- $formatted := list -}}
{{- range $sb.denyRead | sortAlpha -}}
{{- $formatted = append $formatted (printf "`%s`" .) -}}
{{- end -}}

## Working agreements

- Delegate bounded, independent work that repays the handoff — disposable
  searches, log triage, research; state objective, scope, and output format,
  and take back a distilled summary, never a raw dump. Keep inline trivial
  tasks, tightly sequential steps, and edits where you must see the exact lines.
- For unpinned subagents, pick the lowest tier likely to one-shot the task —
  small for bounded mechanical/read-heavy work, mid for routine implementation
  and review, top for hard synthesis or expensive-to-reverse calls; escalate on
  observed failure, not by default.
- Use the docs MCP (e.g. context7) for code generation, setup/config steps, or
  library/API docs — resolve the library id and fetch unprompted.
- Use Playwright for frontend interaction, inspection, and screenshots — not as a
  web-search substitute.
- Web search: built-in by default (cost); Parallel MCP for Reddit / forum /
  anecdotal research, where built-in search comes up empty.
- Keep implementations simple; do not overengineer.
- Match the surrounding code's style, design language, and colocation; if the
  project's rules don't settle it, find the codebase's pattern before writing.
- Bugfix where tests are wired up: learn the project's test style; if a repro
  test is simple and meaningful, write it, see it fail, fix, see it pass. No
  unnecessary cases.
- When I correct your approach or re-explain a convention, offer to record it in
  the project's AGENTS.md (or instructions file) or your memory.
- Never read credential stores, shell history, agent transcripts/session stores,
  or auth config paths such as {{ join ", " $formatted }}, or similar sensitive
  paths, unless I explicitly ask for that specific path. If you believe you read a
  credential, flag it immediately so I can rotate it.
- Chezmoi may resolve secret references into private target configs: keep
  resolved values out of the source repo; never inspect or print those targets.
- Never commit on my behalf — I stage, commit, and push myself.
