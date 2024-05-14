return {
	{
		"toppair/peek.nvim",
		build = "deno task --quiet build:fast",
		config = function()
			require("peek").setup({
				app = "browser",
				theme = vim.g.material_style == "lighter" and "light" or "dark",
			})
		end,
		keys = {
			{
				"<leader>p",
				function()
					require("peek").open()
				end,
				desc = "Preview Markdown",
			},
		},
	},
	{
		"MeanderingProgrammer/markdown.nvim",
		dependencies = { "nvim-treesitter/nvim-treesitter" },
		opts = {},
		ft = "markdown",
		keys = {
			{
				"<leader>m",
				function()
					require("render-markdown").toggle()
				end,
				desc = "Toggle Markdown Render",
			},
		},
	},
}
