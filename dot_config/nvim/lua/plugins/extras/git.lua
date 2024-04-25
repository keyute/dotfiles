return {
	{
		"kdheepak/lazygit.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-telescope/telescope.nvim",
		},
		keys = {
			{ "<leader>gg", "<cmd>LazyGit<CR>", desc = "LazyGit" },
			{
				"<leader>fl",
				function()
					require("telescope").extensions.lazygit.lazygit()
				end,
				desc = "LazyGit",
			},
		},
		config = function()
			require("telescope").load_extension("lazygit")
		end,
	},
	{
		"sindrets/diffview.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		keys = {
			{ "<leader>gd", "<cmd>DiffviewOpen<cr>", desc = "Diffview" },
		},
		opts = {
			view = {
				merge_tool = {
					layout = "diff4_mixed",
				},
			},
		},
	},
	{
		"pwntester/octo.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"nvim-telescope/telescope.nvim",
			"nvim-tree/nvim-web-devicons",
		},
		opts = {},
		cmd = "Octo",
	},
}
