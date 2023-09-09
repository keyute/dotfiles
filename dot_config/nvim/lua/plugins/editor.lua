vim.o.updatetime = 0
vim.o.timeout = true
vim.o.timeoutlen = 300
vim.wo.number = true
vim.wo.wrap = false
vim.o.clipboard = 'unnamed'
vim.o.colorcolumn = "120"
vim.o.cursorline = true
vim.o.expandtab = true
vim.o.tabstop = 2
vim.o.shiftwidth = 2
vim.o.softtabstop = 2

local keyset = vim.keymap.set
local keyopts = { silent = true, noremap = true }
keyset('x', 'd', '"_d', keyopts)

return {
  {
    "windwp/nvim-autopairs",
    event = "InsertEnter",
    dependencies = {
      'hrsh7th/nvim-cmp'
    },
    config = function()
      local cmp_autopairs = require('nvim-autopairs.completion.cmp')
      local cmp = require('cmp')
      cmp.event:on(
        'confirm_done',
        cmp_autopairs.on_confirm_done()
      )
      require('nvim-autopairs').setup({
        check_ts = true,
        enable_check_bracket_line = true,
        ignored_next_char = '[%w%.]'
      })
    end
  },
  {
    'numToStr/Comment.nvim',
    event = "VeryLazy",
    opts = {}
  },
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    dependencies = {
      "nvim-treesitter/nvim-treesitter-refactor"
    },
    event = { "BufReadPost", "BufNewFile" },
    cmd = "TSUpdateSync",
    opts = {
      ensure_installed = "all",
      highlight = { enable = true },
      indent = { enable = true },
      refactor = {
        highlight_definitions = { enable = true },
        smart_rename = {
          enable = true,
          keymaps = { smart_rename = "grr" }
        }
      }
    },
    main = "nvim-treesitter.configs"
  },
  {
    "folke/which-key.nvim",
    event = "VeryLazy",
    opts = {}
  },
  {
    "smjonas/inc-rename.nvim",
    keys = {
      {"<leader>rn", "<cmd>IncRename ", desc = "Smart Rename"}
    },
    opts = {}
  }
}
