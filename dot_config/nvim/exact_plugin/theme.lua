vim.pack.add({
	{ src = "https://github.com/catppuccin/nvim", name = "catppuccin" },
	"https://github.com/f-person/auto-dark-mode.nvim",
})

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
			-- Defined once at load by minuet and grug-far; a colorscheme reload
			-- (auto-dark-mode does one at startup) would otherwise clear them.
			MinuetVirtualText = { link = "Comment" },
			GrugFarResultsAddIndicator = { fg = colors.green },
			GrugFarResultsChangeIndicator = { fg = colors.red },
			GrugFarResultsRemoveIndicator = { fg = colors.red },
		}
	end,
})
vim.cmd.colorscheme("catppuccin")

require("auto-dark-mode").setup({
	update_interval = 1000,
	set_light_mode = function()
		vim.o.background = "light"
		vim.cmd.colorscheme("catppuccin")
	end,
	set_dark_mode = function()
		vim.o.background = "dark"
		vim.cmd.colorscheme("catppuccin")
	end,
})
