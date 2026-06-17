return {
	"lukas-reineke/indent-blankline.nvim",
	main = "ibl",
	event = { "BufReadPost", "BufNewFile" },
	opts = {
		indent = {
			highlight = {
				"RainbowRed",
				"RainbowYellow",
				"RainbowBlue",
				"RainbowOrange",
				"RainbowGreen",
				"RainbowViolet",
				"RainbowCyan",
			},
		},
		exclude = {
			filetypes = { "dashboard" },
		},
	},
}
