vim.filetype.add({
	extension = {
		gotmpl = "gotmpl",
		mdx = "mdx",
	},
	pattern = {
		[".*/templates/.*%.tpl"] = "helm",
		[".*/templates/.*%.ya?ml"] = "helm",
		["helmfile.*%.ya?ml"] = "helm",
	},
})
-- Reuse markdown until upstream offers an MDX parser.
vim.treesitter.language.register("markdown", "mdx")

-- Parsers must be updated together with the plugin. Only updates are hooked;
-- first installs are covered by install() below.
vim.api.nvim_create_autocmd("PackChanged", {
	callback = function(ev)
		if ev.data.spec.name ~= "nvim-treesitter" or ev.data.kind ~= "update" then
			return
		end
		if not ev.data.active then
			vim.cmd.packadd("nvim-treesitter")
		end
		local task = require("nvim-treesitter").update()
		-- Without a UI (headless sync) nvim would quit before the update finishes.
		if #vim.api.nvim_list_uis() == 0 then
			task:wait(300000)
		end
	end,
})

vim.pack.add({ "https://github.com/nvim-treesitter/nvim-treesitter" })

-- c, lua, markdown, markdown_inline, query, vim, and vimdoc are bundled
-- with nvim itself (version-matched parser+query pairs).
local task = require("nvim-treesitter").install({
	"bash",
	"css",
	"diff",
	"dockerfile",
	"go",
	"gotmpl",
	"helm",
	"html",
	"javascript",
	"jsdoc",
	"luadoc",
	"json",
	"python",
	"toml",
	"tsx",
	"typescript",
	"yaml",
	"terraform",
	"hcl",
	"latex",
})
-- Without a UI (headless sync) nvim would quit before the install finishes.
if #vim.api.nvim_list_uis() == 0 then
	task:wait(300000)
end

vim.api.nvim_create_autocmd("FileType", {
	callback = function(args)
		local language = vim.treesitter.language.get_lang(args.match)
		if not pcall(vim.treesitter.start, args.buf, language) then
			return
		end
		local ok, indents = pcall(vim.treesitter.query.get, language, "indents")
		if ok and indents then
			vim.bo[args.buf].indentexpr = "v:lua.require'nvim-treesitter'.indentexpr()"
		end
	end,
})
