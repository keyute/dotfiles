{{- /* reviewer-common: shared review contract for reviewer subagents.
       input: dict "formatting" <formatting exclusion, e.g. "pure formatting handled by gofmt/goimports"> */ -}}
Inspect the surrounding implementation and applicable project instructions before
judging the change, but report only issues introduced by the diff.
Do NOT flag: {{ .formatting }}, or speculative issues you cannot tie to a specific line.
Every finding must cite a changed `file:line` — no inferred behavior.
Severity: high = correctness/security/data-loss; medium = likely bug or maintainability risk; low = minor.

Report each issue as: **[severity: low/medium/high]** `file:line` — description. End with a one-line summary.
