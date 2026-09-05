Vendored from earendil-works/pi v0.85.0
(packages/coding-agent/examples/extensions/plan-mode/).
Refresh deliberately when a pi upgrade breaks it, not automatically.

Local patches (re-apply on refresh):
- utils.ts DESTRUCTIVE_PATTERNS: block find's mutating action flags
  (-delete/-exec/-execdir/-ok/-okdir) — upstream allowlists `find` wholesale,
  so `find . -delete` passed as "read-only".
- utils.ts DESTRUCTIVE_PATTERNS: reject shell composition (`;`, `&&`, `||`,
  newline, `$()`, backticks) and add `clean` to the blocked git verbs —
  upstream anchors safe patterns only at the string start, so a chained
  `find . -print; git clean -fdx` rode in on the safe prefix. Single pipes
  stay allowed for read chains; this check steers, srt is the boundary.
