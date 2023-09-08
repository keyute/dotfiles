#!/bin/bash

nvim --headless "+Lazy! sync" +qa
nvim --headless "+TSUpdateSync" +qa
