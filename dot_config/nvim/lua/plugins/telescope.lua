return {
  {
    "nvim-telescope/telescope.nvim",
    dependencies = {
      "nvim-lua/plenary.nvim"
    },
    cmd = "Telescope",
    keys = {
      { "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Telescope Find Files" },
      { "<leader>fg", "<cmd>Telescope live_grep<cr>",  desc = "Telescope Live Grep" }
    }
  },
  {
    "xiyaowong/telescope-emoji.nvim",
    dependencies = {
      "nvim-telescope/telescope.nvim"
    },
    keys = {
      { "<leader>fe", "<cmd>Telescope emoji<cr>", desc = "Telescope Emoji" }
    },
    cmd = "Telescope emoji",
    config = function()
      require("telescope").load_extension("emoji")
    end
  }
}
