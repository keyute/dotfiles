return {
	"catppuccin/nvim",
	name = "catppuccin",
	priority = 1000,
	config = function()
		---@diagnostic disable-next-line: missing-fields
		require("catppuccin").setup({
			integrations = {
				dropbar = {
					enabled = true,
					color_mode = true,
				},
				snacks = {
					enabled = true,
				},
			},
			-- Rainbow indent-level groups cycled by snacks.indent (previously
			-- defined by the indent_blankline integration).
			custom_highlights = function(colors)
				return {
					RainbowRed = { fg = colors.red },
					RainbowYellow = { fg = colors.yellow },
					RainbowBlue = { fg = colors.blue },
					RainbowOrange = { fg = colors.peach },
					RainbowGreen = { fg = colors.green },
					RainbowViolet = { fg = colors.mauve },
					RainbowCyan = { fg = colors.teal },
				}
			end,
		})
		vim.cmd.colorscheme("catppuccin")
	end,
}
