return {
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPre", "BufNewFile" },
		opts = {},
	},
	{
		"akinsho/git-conflict.nvim",
		version = "*",
		event = { "BufReadPost", "BufNewFile" },
		opts = {},
	},
	{
		-- upstream idle since 2024; dlyongemallo/diffview-plus.nvim is the
		-- active drop-in fork if this ever breaks
		"sindrets/diffview.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		keys = {
			{ "<leader>do", "<cmd>DiffviewOpen<cr>", desc = "[D]iffview [O]pen" },
			{ "<leader>df", "<cmd>DiffviewFileHistory<cr>", desc = "[D]iffview [F]ile History" },
		},
	},
}
