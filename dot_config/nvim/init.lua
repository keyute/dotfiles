-- Plugins
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable", -- latest stable release
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)
require('lazy').setup("plugins")

-- General
vim.wo.number = true
vim.wo.wrap = false
vim.o.clipboard = 'unnamed'
vim.o.colorcolumn = "120"
vim.o.cursorline = true

-- Keymaps
local keyset = vim.keymap.set
local keyopts = { silent = true, noremap = true }
local allModes = {"i", "n", "v"}
keyset('x', 'd', '"_d', keyopts)
keyset(allModes, "<ScrollWheelLeft>", "<ScrollWheelRight>", keyopts)
keyset(allModes, "<ScrollWheelRight>", "<ScrollWheelLeft>", keyopts)

-- Indentation
vim.o.expandtab = true
vim.o.tabstop = 2
vim.o.shiftwidth = 2
vim.o.softtabstop = 2
