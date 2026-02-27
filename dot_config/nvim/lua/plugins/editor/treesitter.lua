return {
	"nvim-treesitter/nvim-treesitter",
	lazy = false,
	build = ":TSUpdate",
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
	config = function()
		require("nvim-treesitter").install({
			"bash", "c", "css", "diff", "dockerfile", "go", "gotmpl", "helm",
			"html", "lua", "luadoc", "json", "markdown", "markdown_inline",
			"python", "query", "vim", "vimdoc", "tsx", "typescript", "yaml",
			"terraform", "hcl",
		})

		vim.api.nvim_create_autocmd("FileType", {
			callback = function(args)
				if pcall(vim.treesitter.start, args.buf) then
					vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
				end
			end,
		})
	end,
}
