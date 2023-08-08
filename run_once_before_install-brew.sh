#!/bin/bash

if ! command -v brew &> /dev/null; then
  echo "Brew is not installed. Installing now..."
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
else
  echo "Brew is already installed. Skipping installation."
fi

brew install starship \
 zsh-autosuggestions \
 zsh-syntax-highlighting \
 zsh-history-substring-search \
 nvim \
 fig
