local M = {
  "nvim-tree/nvim-tree.lua",
  dependencies = {
    "nvim-tree/nvim-web-devicons"
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
    {"<leader>e", "<cmd>NvimTreeFindFileToggle<cr>", "Toggle File Explorer"}
  }
}

vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

return M
