vim.diagnostic.config({
	virtual_text = { current_line = true },
})
vim.opt.signcolumn = "yes"

vim.lsp.inlay_hint.enable(true)
vim.api.nvim_create_autocmd({ "InsertEnter", "InsertLeave" }, {
	callback = function()
		vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
	end,
})

vim.lsp.config("lua_ls", { settings = { Lua = { hint = { enable = true } } } })
vim.lsp.config("ltex", { settings = { ltex = { language = "en-AU" } } })
vim.lsp.config(
	"ts_ls",
	{ settings = { typescript = { preferences = { importModuleSpecifier = "project-relative" } } } }
)

return {
	{
		"williamboman/mason-lspconfig.nvim",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			{
				"williamboman/mason.nvim",
				opts = {},
			},
			"nvim/nvim-lspconfig",
		},
		opts = {
			ensure_installed = {
				"bashls",
				"dockerls",
				"docker_compose_language_service",
				"gopls",
				"gradle_ls",
				"jsonls",
				"jdtls",
				"kotlin_language_server",
				"texlab",
				"lua_ls",
				"marksman",
				"pyright",
				"sqlls",
				"taplo",
				"yamlls",
				"terraformls",
				"helm_ls",
				"ltex",
				"tailwindcss",
				"ts_ls",
				"clangd",
			},
		},
	},
}
