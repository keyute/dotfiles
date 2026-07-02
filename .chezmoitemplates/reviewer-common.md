{{- /* reviewer-common: shared review contract for reviewer subagents.
       input: dict "formatting" <formatting exclusion, e.g. "pure formatting handled by gofmt/goimports"> */ -}}
Do NOT flag: {{ .formatting }}, or speculative issues you cannot tie to a specific line.
Every finding must cite a real `file:line` in the diff — no inferred behavior.
Severity: high = correctness/security/data-loss; medium = likely bug or maintainability risk; low = minor.

Report each issue as: **[severity: low/medium/high]** `file:line` — description. End with a one-line summary.
