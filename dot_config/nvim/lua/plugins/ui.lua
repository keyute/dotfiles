vim.o.mouse = 'a'
vim.o.mousemoveevent = true
vim.o.showmode = false
vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]
vim.o.foldcolumn = '1'
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.wo.numberwidth = 1
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

return {
  {
    "akinsho/bufferline.nvim",
    dependencies = {
      "nvim-tree/nvim-web-devicons"
    },
    event = "VeryLazy",
    opts = {
      options = {
        offsets = {
          {
            filetype = "NvimTree",
            text = "File Explorer",
            text_align = "center",
          }
        },
        close_icon = '',
        modified_icon = '●',
        buffer_close_icon = '󰅖',
        left_trunc_marker = '',
        right_trunc_marker = '',
        hover = {
          enabled = true,
          delay = 0,
          reveal = { 'close' }
        },
        diagnostics = "nvim_lsp",
        diagnostics_indicator = function(count, level, _, _)
          local icon = level:match("error") and " " or " "
          return " " .. icon .. count
        end
      }
    }
  },
  {
    "Bekaboo/dropbar.nvim",
    event = { 'BufReadPost', 'BufWritePost' }
  },
  {
    "lukas-reineke/indent-blankline.nvim",
    event = { 'BufReadPost', 'BufNewFile' },
    opts = {
      show_current_context = true
    }
  },
  {
    'nvim-lualine/lualine.nvim',
    dependencies = {
      'nvim-tree/nvim-web-devicons'
    },
    event = "VeryLazy",
    config = function()
      local function is_markdown()
        return vim.bo.filetype == "markdown" or vim.bo.filetype == "asciidoc"
      end
      local function wordcount()
        return tostring(vim.fn.wordcount().words) .. ' words'
      end
      require('lualine').setup({
        options = {
          theme = "material",
          section_separators = '',
          component_separators = '|'
        },
        sections = {
          lualine_x = {'encoding', 'fileformat', 'filetype', {wordcount, cond = is_markdown}}
        }
      })
    end
  },
  {
    "luukvbaal/statuscol.nvim",
    dependencies = {
      {
        "lewis6991/gitsigns.nvim",
        opts = {}
      }
    },
    event = { "BufReadPre", "BufNewFile" },
    config = function()
      local builtin = require("statuscol.builtin")
      require("statuscol").setup({
        relculright = true,
        segments = {
          { text = { builtin.foldfunc },      click = "v:lua.ScFa" },
          { text = { " " } },
          { text = { "%s" },                  click = "v:lua.ScSa" },
          { text = { builtin.lnumfunc, " " }, click = "v:lua.ScLa" }
        }
      })
    end
  },
  {
    "nvim-tree/nvim-tree.lua",
    dependencies = {
      "nvim-tree/nvim-web-devicons",
      "akinsho/bufferline.nvim"
    },
    opts = {
      renderer = {
        group_empty = true
      },
      filters = {
        custom = {
          ".DS_Store"
        }
      },
    },
    keys = {
      { "<leader>e", "<cmd>NvimTreeFindFileToggle<cr>", "Toggle File Explorer" }
    }
  },
  {
    "folke/noice.nvim",
    event = "VeryLazy",
    opts = {
      presets = {
        inc_rename = true
      }
    },
    dependencies = {
      "MunifTanjim/nui.nvim",
      "rcarriga/nvim-notify"
    }
  }
}
