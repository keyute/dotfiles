return {
  "kdheepak/lazygit.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim"
  },
  keys = {
    { "<leader>gg", ":LazyGit<CR>", desc = "LazyGit" },
    {
      "<leader>fl",
      function()
        require("telescope").extensions.lazygit.lazygit()
      end,
      desc = "LazyGit"
    }
  },
  config = function()
    require("telescope").load_extension("lazygit")
  end
}
