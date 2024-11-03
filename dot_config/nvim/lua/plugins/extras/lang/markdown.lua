return {
	{
		"toppair/peek.nvim",
		build = "deno task --quiet build:fast",
		config = function()
			require("peek").setup({
				app = "browser",
				theme = vim.o.bg,
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
		opts = {
			file_types = { "markdown", "Avante" },
		},
		ft = { "markdown", "Avante" },
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
