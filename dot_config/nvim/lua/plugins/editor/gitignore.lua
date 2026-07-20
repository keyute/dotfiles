return {
	"wintermute-cell/gitignore.nvim",
	dependencies = {
		"folke/snacks.nvim",
	},
	config = function()
		require("gitignore")
	end,
	keys = {
		{ "<leader>gi", "<cmd>Gitignore<cr>", desc = "[G]it[I]gnore" },
	},
}
