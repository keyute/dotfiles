return {
	"nvim-treesitter/nvim-treesitter-context",
	event = { "BufReadPost", "BufNewFile" },
	dependencies = { "nvim-treesitter/nvim-treesitter" },
	opts = {
		max_lines = 3, -- cap the sticky region to the top 3 context lines (0 = unlimited)
		multiline_threshold = 1, -- collapse a multi-line signature down to 1 line
		mode = "cursor", -- context follows the cursor's scope
		trim_scope = "outer",
	},
}
