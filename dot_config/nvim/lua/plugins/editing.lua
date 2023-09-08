vim.o.updatetime = 0

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
    event = { "BufReadPre", "BufNewFile" },
    opts = {}
  },
  {
    "nvim-treesitter/nvim-treesitter",
    build = ":TSUpdate",
    dependencies = {
      "nvim-treesitter/nvim-treesitter-refactor"
    },
    event = { "BufReadPre", "BufNewFile" },
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
  }
}
