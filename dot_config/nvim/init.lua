-- Plugins
local Plug = vim.fn['plug#']
vim.call('plug#begin')
Plug 'itchyny/lightline.vim'
Plug ('neoclide/coc.nvim', {branch = 'release'})
Plug 'jiangmiao/auto-pairs'
Plug 'NLKNguyen/papercolor-theme'
Plug 'f-person/auto-dark-mode.nvim'
Plug ('nvim-treesitter/nvim-treesitter', {['do'] = ':TSUpdate'})
vim.call('plug#end')

-- General Vim Config
vim.wo.number = true
vim.wo.wrap = false
vim.o.clipboard = 'unnamed'

-- Theme
vim.cmd [[colorscheme PaperColor]]
local auto_dark_mode = require('auto-dark-mode')
auto_dark_mode.setup({
  update_interval = 1000,
  set_dark_mode = function()
    vim.api.nvim_set_option('background', 'dark')
  end,
  set_light_mode = function()
    vim.api.nvim_set_option('background', 'light')
  end,
})

-- Lightline Config
vim.o.noshowmode = true
vim.g.lightline = { colorscheme = 'PaperColor'}

-- Indentation
vim.o.expandtab = true
vim.o.tabstop = 2
vim.o.shiftwidth = 2
vim.o.softtabstop = 2

-- CoC Tab Completion
function _G.check_back_space()
  local col = vim.fn.col('.') - 1
  return col == 0 or vim.fn.getline('.'):sub(col, col):match('%s') ~= nil
end

local opts = {silent = true, noremap = true, expr = true, replace_keycodes = false}
local keyset = vim.keymap.set
keyset("i", "<TAB>", 'coc#pum#visible() ? coc#pum#next(1) : v:lua.check_back_space() ? "<TAB>" : coc#refresh()', opts)
keyset("i", "<S-TAB>", [[coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"]], opts)

-- CoC Config
vim.g.coc_global_extensions = {'coc-json', 'coc-yaml', 'coc-toml', 'coc-sumneko-lua'}

-- Treesitter Config
require('nvim-treesitter.configs').setup({
  ensure_installed = {"lua", "json", "yaml", "toml"},
  highlight = {
    enable = true
  }
})
