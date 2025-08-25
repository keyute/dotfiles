return {
	{
		"lewis6991/gitsigns.nvim",
		opts = {},
	},
	{
		"sindrets/diffview.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		keys = {
			{ "<leader>do", "<cmd>DiffviewOpen<cr>", desc = "[D]iffview [O]pen" },
			{ "<leader>df", "<cmd>DiffviewFileHistory", desc = "[Diffview] [F]ile History" },
		},
	},
}
