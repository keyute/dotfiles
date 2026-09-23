#!/bin/bash
set -euo pipefail

# Prerequisites for the rest of the apply: agent_npm_deps (before) needs npm,
# and the .claude.json modify script needs jq, both ahead of any repo-managed
# package install (brew bundle is an after script). run_once: a prereq, not
# managed state — brew owns these packages afterwards.
command -v node >/dev/null || brew install node
command -v jq >/dev/null || brew install jq
