#!/bin/bash
# The gate for CI and agents: apply the whole tree into a scratch home — every
# template and modify_ script renders, 1Password stubbed, run scripts and
# externals left out — then assert the few failures that would render silently.
set -euo pipefail

src=$(cd "$(dirname "$0")/.." && pwd)
# an explicit template: macOS `mktemp -d` alone ignores an inherited TMPDIR
tmp=$(mktemp -d "${TMPDIR:-/tmp}/chezmoi-check.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
mkdir "$tmp/bin" "$tmp/home"
printf '#!/bin/sh\nprintf op-stub\n' >"$tmp/bin/op"
chmod +x "$tmp/bin/op"
PATH="$tmp/bin:$PATH"

cz() {
  chezmoi "$@" --no-tty --source "$src" --destination "$tmp/home" \
    --config "$tmp/chezmoi.toml" --persistent-state "$tmp/state.boltdb" \
    --cache "$tmp/cache" --refresh-externals=never
}
cz apply --exclude scripts,externals

data=$(cz data --format=json)
agents="$tmp/home/.claude/agents"
frontier=$(jq -r '.subagent_tiers.claude.frontier' <<<"$data")
# its own assignment: inside a larger $( ) a jq error would not stop the script
failures=$(jq -r --slurpfile claude "$tmp/home/.claude/settings.json" --slurpfile kopi "$tmp/home/.kopi/config.json" '
  [.agent_sandbox.filesystem.paths | to_entries[] | select(.value == "none").key] as $none
  | (($none | map("Read(\(.))")) - $claude[0].permissions.deny | map("claude permissions.deny lacks \(.)")),
    ($none - $kopi[0].sandbox.denyRead | map("kopi sandbox.denyRead lacks \(.)")),
    (($none | map("*(\(.))")) - $kopi[0].permissions.deny | map("kopi permissions.deny lacks \(.)")),
    ($claude[0].permissions.allow + $kopi[0].permissions.allow
      | map(select(startswith("mcp__") and (test("^mcp__.+__[^*]") | not)) | "server-wide MCP allow rule \(.)"))
  | .[]' <<<"$data")
# the frontier is the escalation driver: no role runs on it
[ -z "$(grep -lx "model: $frontier" "$agents"/*.md)" ] ||
  failures="${failures:+$failures$'\n'}the frontier pin $frontier is on an agent file"
if [ -n "$failures" ]; then
  printf '%s\n' "$failures" >&2
  exit 1
fi
echo "ok"
