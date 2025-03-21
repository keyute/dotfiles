return {
	{
		"VonHeikemen/lsp-zero.nvim",
		branch = "v4.x",
		lazy = true,
		config = false,
	},
	{
		"neovim/nvim-lspconfig",
		cmd = "LspInfo",
		event = { "BufReadPre", "BufNewFile" },
		dependencies = {
			{ "saghen/blink.cmp" },
			{
				"williamboman/mason-lspconfig.nvim",
				dependencies = {
					{
						"williamboman/mason.nvim",
						opts = {},
					},
				},
			},
			{
				"kevinhwang91/nvim-ufo",
				dependencies = {
					"kevinhwang91/promise-async",
				},
				opts = {
					provider_selector = function()
						return function(bufnr)
							local function handleFallbackException(providerName)
								return require("ufo").getFolds(bufnr, providerName)
							end
							return require("ufo")
								.getFolds(bufnr, "lsp")
								:catch(function()
									return handleFallbackException("treesitter")
								end)
								:catch(function()
									return handleFallbackException("indent")
								end)
						end
					end,
				},
			},
			{
				"lewis6991/hover.nvim",
				dependencies = {
					"kevinhwang91/nvim-ufo",
				},
				opts = {
					init = function()
						require("hover.providers.lsp")
					end,
					title = false,
				},
				keys = {
					{
						"K",
						function()
							local winid = require("ufo").peekFoldedLinesUnderCursor()
							if not winid then
								require("hover").hover()
							end
						end,
						desc = "Hover",
					},
				},
			},
		},
		init = function()
			vim.opt.signcolumn = "yes"
		end,
		config = function()
			local lsp_defaults = require("lspconfig").util.default_config
			lsp_defaults.capabilities = vim.tbl_deep_extend("force", lsp_defaults.capabilities, {
				textDocument = {
					foldingRange = {
						dynamicRegistration = false,
						lineFoldingOnly = true,
					},
				},
			})
			local lsp_zero = require("lsp-zero")
			lsp_zero.on_attach(function(client, bufnr)
				lsp_zero.default_keymaps({ buffer = bufnr })
				if client.server_capabilities.inlayHintProvider then
					vim.lsp.inlay_hint.enable(true, { bufnr = bufnr })
					local group = vim.api.nvim_create_augroup("InlayHints", { clear = false })
					vim.api.nvim_create_autocmd("InsertEnter", {
						group = group,
						buffer = bufnr,
						callback = function()
							vim.lsp.inlay_hint.enable(false, { bufnr = bufnr })
						end,
					})
					vim.api.nvim_create_autocmd("InsertLeave", {
						group = group,
						buffer = bufnr,
						callback = function()
							vim.lsp.inlay_hint.enable(true, { bufnr = bufnr })
						end,
					})
				end
			end)
			require("mason-lspconfig").setup({
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
				handlers = {
					function(server_name)
						require("lspconfig")[server_name].setup({})
					end,
					lua_ls = function()
						local lua_opts = lsp_zero.nvim_lua_ls({ settings = { Lua = { hint = { enable = true } } } })
						require("lspconfig").lua_ls.setup(lua_opts)
					end,
					pyright = function()
						local path = require("lspconfig/util").path
						local function get_python_path(workspace)
							if vim.env.VIRTUAL_ENV then
								return path.join(vim.env.VIRTUAL_ENV, "bin", "python")
							end
							for _, pattern in ipairs({ "*", ".*" }) do
								local match = vim.fn.glob(path.join(workspace, pattern, "pyvenv.cfg"))
								if match ~= "" then
									return path.join(path.dirname(match), "bin", "python")
								end
							end
							return vim.fn.exepath("python3") or vim.fn.exepath("python") or "python"
						end
						require("lspconfig").pyright.setup({
							before_init = function(_, config)
								config.settings.python.pythonPath = get_python_path(config.root_dir)
							end,
						})
					end,
					ltex = function()
						require("lspconfig").ltex.setup({ settings = { ltex = { language = "en-AU" } } })
					end,
					gopls = function()
						local cfg = require("go.lsp").config()
						require("lspconfig").gopls.setup(cfg)
					end,
					ts_ls = function()
						require("lspconfig").ts_ls.setup({
							settings = {
								typescript = {
									preferences = {
										importModuleSpecifier = "project-relative",
									},
								},
							},
						})
					end,
				},
			})
			lsp_zero.set_sign_icons({
				error = "✘",
				warn = "▲",
				hint = "⚑",
				info = "»",
			})
		end,
	},
}
