return {
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
  init = function()
    vim.g.loaded_netrw = 1
    vim.g.loaded_netrwPlugin = 1
    vim.keymap.set("n", "<leader>e", ":NvimTreeFindFileToggle<CR>", {noremap = true, silent = true})
  end
}
