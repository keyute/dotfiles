return {
	"mason-org/mason-lspconfig.nvim",
	event = { "BufReadPre", "BufNewFile" },
	dependencies = {
		{ "mason-org/mason.nvim", opts = {} },
		"neovim/nvim-lspconfig",
		"WhoIsSethDaniel/mason-tool-installer.nvim",
		{ "j-hui/fidget.nvim", opts = {} },
		"saghen/blink.cmp",
		"b0o/schemastore.nvim",
	},
	config = function()
		vim.lsp.config("*", {
			capabilities = require("blink.cmp").get_lsp_capabilities(),
		})

		vim.api.nvim_create_autocmd("LspAttach", {
			group = vim.api.nvim_create_augroup("kickstart-lsp-attach", { clear = true }),
			callback = function(event)
				local map = function(keys, func, desc, mode)
					mode = mode or "n"
					vim.keymap.set(mode, keys, func, { buffer = event.buf, desc = "LSP: " .. desc })
				end

				map("grr", function()
					require("telescope.builtin").lsp_references()
				end, "[G]oto [R]eferences")
				map("gri", function()
					require("telescope.builtin").lsp_implementations()
				end, "[G]oto [I]mplementation")
				map("grd", function()
					require("telescope.builtin").lsp_definitions()
				end, "[G]oto [D]efinition")
				map("grD", vim.lsp.buf.declaration, "[G]oto [D]eclaration")
				map("gO", function()
					require("telescope.builtin").lsp_document_symbols()
				end, "Open Document Symbols")
				map("gW", function()
					require("telescope.builtin").lsp_dynamic_workspace_symbols()
				end, "Open Workspace Symbols")
				map("grt", function()
					require("telescope.builtin").lsp_type_definitions()
				end, "[G]oto [T]ype Definition")

				local client = vim.lsp.get_client_by_id(event.data.client_id)
				if
					client
					and client:supports_method(vim.lsp.protocol.Methods.textDocument_documentHighlight, event.buf)
				then
					local highlight_augroup = vim.api.nvim_create_augroup("kickstart-lsp-highlight", { clear = false })
					vim.api.nvim_create_autocmd({ "CursorHold", "CursorHoldI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.document_highlight,
					})

					vim.api.nvim_create_autocmd({ "CursorMoved", "CursorMovedI" }, {
						buffer = event.buf,
						group = highlight_augroup,
						callback = vim.lsp.buf.clear_references,
					})

					vim.api.nvim_create_autocmd("LspDetach", {
						group = vim.api.nvim_create_augroup("kickstart-lsp-detach", { clear = true }),
						callback = function(event2)
							vim.lsp.buf.clear_references()
							vim.api.nvim_clear_autocmds({
								group = "kickstart-lsp-highlight",
								buffer = event2.buf,
							})
						end,
					})
				end

				if client and client:supports_method(vim.lsp.protocol.Methods.textDocument_inlayHint, event.buf) then
					vim.lsp.inlay_hint.enable(true, { bufnr = event.buf })

					vim.api.nvim_create_autocmd("InsertEnter", {
						buffer = event.buf,
						callback = function()
							vim.lsp.inlay_hint.enable(false, { bufnr = event.buf })
						end,
					})

					vim.api.nvim_create_autocmd("InsertLeave", {
						buffer = event.buf,
						callback = function()
							vim.lsp.inlay_hint.enable(true, { bufnr = event.buf })
						end,
					})

					map("<leader>th", function()
						vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled({ bufnr = event.buf }))
					end, "[T]oggle Inlay [H]ints")
				end
			end,
		})

		vim.diagnostic.config({
			severity_sort = true,
			float = { border = "rounded", source = "if_many" },
			underline = { severity = vim.diagnostic.severity.ERROR },
			signs = vim.g.have_nerd_font and {
				text = {
					[vim.diagnostic.severity.ERROR] = "󰅚 ",
					[vim.diagnostic.severity.WARN] = "󰀪 ",
					[vim.diagnostic.severity.INFO] = "󰋽 ",
					[vim.diagnostic.severity.HINT] = "󰌶 ",
				},
			} or {},
			virtual_text = { source = "if_many", spacing = 2 },
		})

		require("mason-tool-installer").setup({
			ensure_installed = {
				"stylua",
				"prettier",
				"prettierd",
				"ruff",
				"rumdl",
				"yamlfmt",
				"sqlfluff",
				"eslint_d",
				"golangci-lint",
				-- go.nvim helper binaries — installed here (async, non-blocking) instead of
				-- go.nvim's synchronous `build` hook, which blocks nvim on every :Lazy update.
				"gofumpt",
				"goimports",
				"gomodifytags",
				"gotests",
				"iferr",
				"delve",
			},
		})

		require("mason-lspconfig").setup({
			automatic_enable = true,
			ensure_installed = {
				"lua_ls",
				"bashls",
				"dockerls",
				"docker_compose_language_service",
				"gopls",
				"marksman",
				"jsonls",
				"helm_ls",
				"pyright",
				"tailwindcss",
				"ts_ls",
				"yamlls",
				"tofu_ls",
				"html",
				"cssls",
				"taplo",
				"texlab",
			},
		})
	end,
}
