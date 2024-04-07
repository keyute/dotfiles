return {
	"ray-x/go.nvim",
	dependencies = {
		"ray-x/guihua.lua",
		"neovim/nvim-lspconfig",
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		require("go").setup()
		require("go.env").load_env()
	end,
	ft = { "go", "gomod" },
	build = function()
		require("go.install").update_all()
	end,
}
