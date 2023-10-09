#!/bin/bash

if ! command -v brew &> /dev/null; then
  echo "Brew is not installed. Installing now..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Brew is already installed. Skipping installation."
fi

# Brewfile hash: {{ include ".Brewfile" | sha256sum }}

brew bundle install --no-lock --cleanup --file $(chezmoi source-path .Brewfile)
brew cleanup --prune=all
