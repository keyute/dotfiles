return {
	"nvim-lualine/lualine.nvim",
	depdendencies = {
		"nvim-tree/nvim-web-devicons",
	},
	opts = {
		options = {
			theme = "catppuccin",
			section_separators = "",
			component_separators = "|",
		},
		sections = {
			lualine_x = {
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
						return vim.bo.filetype == "markdown" or vim.bo.filetype == "asciidoc"
					end,
				},
			},
		},
	},
}
