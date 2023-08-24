#!/bin/bash

if ! command -v brew &> /dev/null; then
  echo "Brew is not installed. Installing now..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Brew is already installed. Skipping installation."
fi

brew bundle --no-lock --file=/dev/stdin <<EOF
tap "artginzburg/tap"
tap "beeftornado/rmtree"
tap "buo/cask-upgrade"
tap "cockroachdb/tap"
tap "homebrew/bundle"
tap "homebrew/services"
brew "chezmoi"
brew "cloudflared"
brew "git-lfs"
brew "go"
brew "golang-migrate"
brew "helm"
brew "k9s"
brew "kubernetes-cli"
brew "krew"
brew "minio-mc"
brew "neovim"
brew "node@18", link: true
brew "openjdk@17", link: true
brew "python@3.11"
brew "rabbitmq", restart_service: true
brew "redis", restart_service: true
brew "starship"
brew "zsh-autosuggestions"
brew "zsh-history-substring-search"
brew "zsh-syntax-highlighting"
brew "artginzburg/tap/sudo-touchid"
brew "cockroachdb/tap/cockroach"
cask "fig"
cask "google-cloud-sdk"
cask "mactex-no-gui"
EOF
