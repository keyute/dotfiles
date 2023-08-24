#!/bin/bash

nvim --headless "+Lazy! sync" +qa
nvim --headless "+TSUpdateSync" +qa
nvim --headless "+CocInstall -sync" +qa
nvim --headless "+CocUpdateSync" +qa
