# dotfiles

Managed with [chezmoi](https://chezmoi.io). Agent tooling (Claude Code, Codex)
is driven from a single source of truth in `.chezmoidata/agents.yaml` and shared
templates under `.chezmoitemplates/`.

## Fresh machine bootstrap

Chezmoi's run order is: template render → `run_onchange_before_*` scripts →
file targets (including `modify_` scripts) → `run_onchange_after_*` scripts.
The prerequisites below exist because some tools are needed **before** the
after-scripts that would otherwise install them.

### Prerequisites — macOS

1. Install [Homebrew](https://brew.sh).
2. `brew install chezmoi node git && brew install --cask 1password-cli`
3. Sign into 1Password and enable CLI integration — templates resolve secrets
   via `onepasswordRead` at render time (even for `chezmoi diff`).
4. `chezmoi init --apply <repo>`

`jq` ships with macOS. Everything else (go, lazygit, ...) is installed by the
Brewfile after-script on first apply, which also takes over ownership of node
and the 1Password CLI from then on.

### Prerequisites — Linux

The Brewfile is not applied on Linux (`.chezmoiignore`), so install via the
distro package manager: `git`, `chezmoi`, `node` + `npm`, `jq`, and the
1Password CLI (signed in). Playwright's browser install runs with `--with-deps`
on Linux and may need sudo for OS packages.

### What runs when

- `run_onchange_before_agent_npm_deps.sh` — `npm ci` into the repo's
  `node_modules` (MCP server binaries, ccstatusline, smol-toml) plus a
  Playwright chromium install. Runs before any file is applied, so everything
  the applied configs point at already exists.
- `modify_private_dot_claude.json` — merges managed MCP servers into
  `~/.claude.json` with `jq`, preserving the rest of the file.
- `private_dot_codex/modify_private_config.toml` — merges managed settings into
  `~/.codex/config.toml` via `scripts/merge-codex-config.mjs` (smol-toml),
  preserving Codex's runtime state (trusted projects, etc.). `tui.theme` is
  deliberately deleted and not re-emitted so every machine uses Codex's default
  theme detection. If the merge script fails (e.g. node missing), chezmoi
  aborts without touching the file.
- `run_onchange_after_brew.sh` — `brew bundle` from the Brewfile (macOS only).

Known edge: a *targeted* `chezmoi apply ~/.codex/config.toml` on a fresh
machine skips the npm before-script, so the merge script exits non-zero and the
apply fails cleanly. A full `chezmoi apply` self-heals.
