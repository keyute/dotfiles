return {
	"mikavilpas/yazi.nvim",
	version = "*",
	event = "VeryLazy",
	dependencies = {
		{ "nvim-lua/plenary.nvim", lazy = true },
	},
	keys = {
		{
			"<leader>yf",
			mode = { "n", "v" },
			"<cmd>Yazi<cr>",
			desc = "Open [Y]azi at the current [F]ile",
		},
		{
			"<leader>yd",
			"<cmd>Yazi cwd<cr>",
			desc = "Open [Y]azi in nvim's working [D]irectory",
		},
	},
	opts = {
		open_for_directories = false,
	},
}
