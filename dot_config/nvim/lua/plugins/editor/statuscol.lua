return {
	"luukvbaal/statuscol.nvim",
	event = { "BufReadPost", "BufNewFile" },
	dependencies = {
		"lewis6991/gitsigns.nvim",
	},
	config = function()
		local builtin = require("statuscol.builtin")
		require("statuscol").setup({
			segments = {
				{
					text = { builtin.lnumfunc, " " },
					condition = { true, builtin.not_empty },
					click = "v:lua.ScLa",
				},
				-- Catch-all sign column: diagnostics, todo-comments, markdown, etc.
				-- name matches legacy signs, namespace matches extmark signs; the
				-- dedicated gitsigns segment below is auto-excluded from here.
				-- auto = true collapses the column to zero width when the buffer
				-- has no such signs (e.g. no LSP diagnostics), for a leaner gutter.
				{
					sign = { name = { ".*" }, namespace = { ".*" }, maxwidth = 1, colwidth = 1, auto = true },
					click = "v:lua.ScSa",
				},
				{ text = { builtin.foldfunc, " " }, click = "v:lua.ScFa" },
				-- Gitsigns change markers, closest to the code
				{
					sign = { namespace = { "gitsigns" }, maxwidth = 1, colwidth = 1, auto = false },
					click = "v:lua.ScSa",
				},
			},
			clickhandlers = {
				FoldOther = false,
			},
		})
	end,
}
