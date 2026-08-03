return {
	{
		"lewis6991/gitsigns.nvim",
		event = { "BufReadPre", "BufNewFile" },
		opts = {},
	},
	{
		-- actively maintained drop-in fork of sindrets/diffview.nvim, whose
		-- upstream has been idle since 2024
		"dlyongemallo/diffview-plus.nvim",
		cmd = { "DiffviewOpen", "DiffviewFileHistory" },
		opts = {
			view = {
				-- entered from lazygit purely to resolve, so skip the file panel
				merge_tool = { focus_diff = true },
			},
		},
		keys = {
			{ "<leader>do", "<cmd>DiffviewOpen<cr>", desc = "[D]iffview [O]pen" },
			{ "<leader>df", "<cmd>DiffviewFileHistory<cr>", desc = "[D]iffview [F]ile History" },
		},
	},
}
