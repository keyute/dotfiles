return {
	{
		"nvim-telescope/telescope.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			"folke/noice.nvim",
			{
				"nvim-telescope/telescope-fzf-native.nvim",
				build = "make",
			},
		},
		cmd = "Telescope",
		keys = {
			{ "<leader>ff", "<cmd>Telescope find_files<cr>", desc = "Telescope Find Files" },
			{ "<leader>fg", "<cmd>Telescope live_grep<cr>", desc = "Telescope Live Grep" },
			{ "<leader>fn", "<cmd>Noice telescope<cr>", desc = "Telescope Noice" },
		},
		config = function()
			require("telescope").load_extension("fzf")
		end,
	},
	{
		"xiyaowong/telescope-emoji.nvim",
		dependencies = {
			"nvim-telescope/telescope.nvim",
		},
		keys = {
			{ "<leader>fe", "<cmd>Telescope emoji<cr>", desc = "Telescope Emoji" },
		},
		cmd = "Telescope emoji",
		config = function()
			require("telescope").load_extension("emoji")
		end,
	},
	{
		"wintermute-cell/gitignore.nvim",
		dependencies = {
			"nvim-telescope/telescope.nvim",
		},
		cmd = "Gitignore",
		keys = {
			{ "<leader>gi", "<cmd>Gitignore<cr>", desc = "Generate gitignore" },
		},
	},
}
