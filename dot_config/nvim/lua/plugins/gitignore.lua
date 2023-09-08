return {
  "wintermute-cell/gitignore.nvim",
  dependencies = {
    "nvim-telescope/telescope.nvim"
  },
  cmd = "Gitignore",
  keys = {
    { "<leader>gi", "<cmd>Gitignore<cr>", desc = "Generate gitignore" }
  }
}
