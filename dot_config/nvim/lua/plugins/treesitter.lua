local M = {
  "nvim-treesitter/nvim-treesitter",
  build = ":TSUpdate",
  opts = {
    ensure_installed = {
      "lua", "json", "yaml", "toml", "bash", "terraform", "python", "markdown", "markdown_inline", "mermaid"
    },
    highlight = { enable = true },
    indent = { enable = true }
  },
  main = "nvim-treesitter.configs"
}

vim.wo.foldmethod = "expr"
vim.wo.foldexpr = "nvim_treesitter#foldexpr()"

return M
