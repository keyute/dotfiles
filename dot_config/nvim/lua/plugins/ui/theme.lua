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
				indent_blankline = {
					enabled = true,
					colored_indent_levels = true,
				},
			},
		})
		vim.cmd.colorscheme("catppuccin")
	end,
}
