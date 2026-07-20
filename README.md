# dotfiles

Managed with [chezmoi](https://chezmoi.io).

## macOS

1. Install [Homebrew](https://brew.sh).
2. `brew install chezmoi node git && brew install --cask 1password-cli`
3. Sign into 1Password and enable the CLI integration.
4. `chezmoi init --apply keyute`

## Linux

1. Install with your distro package manager: `git`, `chezmoi`, `node`, `npm`,
   `jq`, and the 1Password CLI.
2. Sign into 1Password and enable the CLI integration.
3. `chezmoi init --apply keyute`
