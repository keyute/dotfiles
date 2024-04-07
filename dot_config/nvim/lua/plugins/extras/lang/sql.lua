return {
	"kristijanhusak/vim-dadbod-ui",
	dependencies = {
		"tpope/vim-dadbod",
		"kristijanhusak/vim-dadbod-completion",
	},
	cmd = "DBUI",
	keys = {
		{ "<leader>bb", "<cmd>DBUI<cr>", desc = "Open Dadbod UI" },
	},
}
