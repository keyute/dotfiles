return {
	"linux-cultist/venv-selector.nvim",
	branch = "regexp",
	dependencies = { "neovim/nvim-lspconfig", "nvim-telescope/telescope.nvim" },
	opts = {},
	keys = {
		{ "<leader>vs", "<cmd>VenvSelect<cr>", desc = "Select Python Venv" },
	},
}
