return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	main = "nvim-treesitter.configs",
	init = function()
		vim.filetype.add({
			extension = {
				gotmpl = "gotmpl",
			},
			pattern = {
				[".*/templates/.*%.tpl"] = "helm",
				[".*/templates/.*%.ya?ml"] = "helm",
				["helmfile.*%.ya?ml"] = "helm",
			},
		})
	end,
	opts = {
		ensure_installed = {
			"bash",
			"c",
			"css",
			"diff",
			"dockerfile",
			"go",
			"gotmpl",
			"helm",
			"html",
			"lua",
			"luadoc",
			"json",
			"markdown",
			"markdown_inline",
			"python",
			"query",
			"vim",
			"vimdoc",
			"tsx",
			"typescript",
			"yaml",
		},
		auto_install = true,
		highlight = {
			enable = true,
			additional_vim_regex_highlighting = { "ruby" },
		},
		indent = { enable = true, disable = { "ruby" } },
	},
}
