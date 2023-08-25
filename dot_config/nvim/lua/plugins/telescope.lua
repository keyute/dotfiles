return {
  "nvim-telescope/telescope.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim"
  },
  cmd = "Telescope",
  keys = {
    { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Telescope Find Files" },
    { "<leader>fg", "<cmd>Telescope live_grep<cr>", desc = "Telescope Live Grep" }
  }
}
