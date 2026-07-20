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
		-- c, lua, markdown, markdown_inline, query, vim, and vimdoc are bundled
		-- with nvim itself (version-matched parser+query pairs).
		require("nvim-treesitter").install({
			"bash", "css", "diff", "dockerfile", "go", "gotmpl", "helm",
			"html", "javascript", "jsdoc", "luadoc", "json", "python",
			"toml", "tsx", "typescript", "yaml", "terraform", "hcl", "latex",
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
