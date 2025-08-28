return {
	"wintermute-cell/gitignore.nvim",
	dependencies = {
		"nvim-telescope/telescope.nvim",
	},
	config = function()
		require("gitignore")
	end,
	keys = {
		{ "<leader>gi", "<cmd>Gitignore<cr>", desc = "[G]it[I]gnore" },
	},
}
