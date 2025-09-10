return {
	"akinsho/toggleterm.nvim",
	opts = {},
	keys = {
		{ "<leader>tt", "<cmd>ToggleTerm direction=tab<cr>", desc = "[T]erminal in New [T]ab" },
		{ "<leader>tv", "<cmd>ToggleTerm direction=vertical<cr>", desc = "[T]erminal in [V]ertical Tab" },
		{ "<leader>th", "<cmd>ToggleTerm direction=horizontal<cr>", desc = "[T]erminal in [H]orizontal Tab" },
	},
}
