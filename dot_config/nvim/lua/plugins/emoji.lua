return {
  "xiyaowong/telescope-emoji.nvim",
  dependencies = {
    "nvim-telescope/telescope.nvim"
  },
  keys = {
    {"<leader>fe", "<cmd>Telescope emoji<cr>", desc = "Telescope Emoji"}
  },
  cmd = "Telescope emoji",
  config = function()
    require("telescope").load_extension("emoji")
  end
}
