local M = {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  dependencies = {
    "nvim-treesitter/nvim-treesitter-refactor"
  },
  event = "VeryLazy",
  opts = {
    ensure_installed = {
      "lua", "json", "yaml", "toml", "bash", "terraform", "python", "markdown", "markdown_inline", "mermaid", "java",
      "kotlin"
    },
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

vim.o.updatetime = 0
vim.wo.foldmethod = "expr"
vim.wo.foldexpr = "nvim_treesitter#foldexpr()"

return M
