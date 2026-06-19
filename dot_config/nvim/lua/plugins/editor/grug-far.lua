return { -- Project-wide find & replace
	"MagicDuck/grug-far.nvim",
	cmd = "GrugFar",
	opts = {},
	keys = {
		{
			"<leader>rr",
			function()
				require("grug-far").open()
			end,
			desc = "[R]eplace in p[r]oject (grug-far)",
		},
		{
			"<leader>rf",
			function()
				require("grug-far").open({ prefills = { paths = vim.fn.expand("%") } })
			end,
			desc = "[R]eplace in [F]ile (grug-far)",
		},
		{
			"<leader>r",
			mode = "x",
			function()
				require("grug-far").with_visual_selection()
			end,
			desc = "[R]eplace selection (grug-far)",
		},
	},
}
