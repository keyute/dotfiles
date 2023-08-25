local M = {
  "nvim-telescope/telescope.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim"
  },
  cmd = "Telescope"
}

local opts = { silent = true, noremap = true }
local keyset = vim.keymap.set
keyset('n', '<leader>ff', ":Telescope find_files<CR>", opts)
keyset('n', '<leader>fg', ':Telescope live_grep<CR>', opts)

return M
