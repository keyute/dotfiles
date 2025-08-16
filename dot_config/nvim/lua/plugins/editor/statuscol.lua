return {
	"luukvbaal/statuscol.nvim",
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
				{ text = { "%C" }, click = "v:lua.ScFa" },
				{ text = { "%s" }, click = "v:lua.ScSa" },
			},
		})
	end,
}
