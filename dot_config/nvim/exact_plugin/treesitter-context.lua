vim.pack.add({ "https://github.com/nvim-treesitter/nvim-treesitter-context" })

require("treesitter-context").setup({
	max_lines = 3, -- cap the sticky region to the top 3 context lines (0 = unlimited)
	multiline_threshold = 1, -- collapse a multi-line signature down to 1 line
	mode = "cursor", -- context follows the cursor's scope
	trim_scope = "outer",
})
