return {
	"ray-x/go.nvim",
	dependencies = {
		"ray-x/guihua.lua",
		"neovim/nvim-lspconfig",
	},
	config = function()
		require("go").setup()
		vim.lsp.config("gopls", require("go.lsp").config())
	end,
	ft = { "go", "gomod" },
}
