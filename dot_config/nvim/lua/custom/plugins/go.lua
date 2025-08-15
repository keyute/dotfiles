return {
	"ray-x/go.nvim",
	dependencies = {
		"ray-x/guihua.lua",
		"neovim/nvim-lspconfig",
		"nvim-treesitter/nvim-treesitter",
	},
	config = function()
		require("go").setup()
		vim.lsp.config("gopls", require("go.lsp").config())
	end,
	ft = { "go", "gomod" },
	build = function()
		require("go.install").update_all_sync()
	end,
}
