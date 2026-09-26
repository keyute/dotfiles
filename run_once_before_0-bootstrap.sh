#!/bin/bash
set -euo pipefail

# Prerequisites for the rest of the apply: agent_npm_deps (before) needs npm
# ahead of any repo-managed package install (brew bundle is an after script).
# run_once: a prereq, not managed state — brew owns node afterwards. The modify
# scripts' jq is /usr/bin/jq, shipped with macOS since 15.
command -v node >/dev/null || brew install node
