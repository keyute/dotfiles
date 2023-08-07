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
require('lazy').setup({
  {
    "neoclide/coc.nvim",
    branch = "release",
    config = function()
      function _G.check_back_space()
        local col = vim.fn.col('.') - 1
        return col == 0 or vim.fn.getline('.'):sub(col, col):match('%s') ~= nil
      end
      local opts = {silent = true, noremap = true, expr = true, replace_keycodes = false}
      local keyset = vim.keymap.set
      keyset("i", "<TAB>", 'coc#pum#visible() ? coc#pum#next(1) : v:lua.check_back_space() ? "<TAB>" : coc#refresh()', opts)
      keyset("i", "<S-TAB>", [[coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"]], opts)

      vim.g.coc_global_extensions = {'coc-json', 'coc-yaml', 'coc-toml', 'coc-sumneko-lua'}
    end
  },
  {
    "windwp/nvim-autopairs",
    event = "InsertEnter",
    opts = {
      check_ts = true,
      enable_check_bracket_line = true,
      ignored_next_char = "[%w%.]"
    }
  },
  {
    'NLKNguyen/papercolor-theme',
    config = function()
      vim.cmd([[colorscheme PaperColor]])
    end,
  },
  {
    "f-person/auto-dark-mode.nvim",
    opts = {
      update_interval = 1000,
      set_dark_mode = function()
        vim.o.background = "dark"
      end,
      set_light_mode = function()
        vim.o.background = "light"
      end
    }
  },
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    config = function ()
      local configs = require("nvim-treesitter.configs")
      configs.setup({
        ensure_installed = {"lua", "json", "yaml", "toml"},
        highlight = { enable = true }
      })
    end
  },
  {
    "itchyny/lightline.vim",
    config = function()
      vim.o.showmode = false
      vim.g.lightline = { colorscheme = 'PaperColor' }
    end
  },
  {
    "romgrk/barbar.nvim",
    dependencies = {
      "nvim-tree/nvim-web-devicons"
    }
  },
  {
    "lukas-reineke/indent-blankline.nvim",
    opts = {
      show_current_context = true
    }
  }
})

-- General Vim Config
vim.wo.number = true
vim.wo.wrap = false
vim.o.clipboard = 'unnamed'
vim.api.nvim_set_keymap('x', 'd', '"_d', { noremap = true, silent = true })

-- Indentation
vim.o.expandtab = true
vim.o.tabstop = 2
vim.o.shiftwidth = 2
vim.o.softtabstop = 2
