return {
	"nvim-lualine/lualine.nvim",
	event = "VeryLazy",
	dependencies = {
		"nvim-mini/mini.icons",
	},
	opts = {
		options = {
			section_separators = "",
			component_separators = "|",
		},
		sections = {
			lualine_x = {
				-- vim.ui.progress_status() doesn't cover LSP ($/progress only fires
				-- LspProgress, which this component subscribes to)
				"lsp_status",
				function()
					if vim.o.expandtab then
						return tostring(vim.o.shiftwidth) .. " spaces"
					else
						return "Tab"
					end
				end,
				"encoding",
				"fileformat",
				"filetype",
				{
					function()
						return tostring(vim.fn.wordcount().words) .. " words"
					end,
					cond = function()
						return vim.bo.filetype == "markdown"
							or vim.bo.filetype == "asciidoc"
							or vim.bo.filetype == "tex"
					end,
				},
			},
		},
	},
}
