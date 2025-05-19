vim.o.updatetime = 0
vim.o.timeout = true
vim.o.timeoutlen = 300
vim.wo.number = true
vim.wo.wrap = false
vim.o.clipboard = "unnamed"
vim.o.colorcolumn = "120"
vim.o.cursorline = true
vim.o.expandtab = true
vim.o.shiftwidth = 4
vim.o.tabstop = 4

local keyset = vim.keymap.set
local keyopts = { silent = true, noremap = true }
keyset("x", "d", '"_d', keyopts)

return {
	{
		"saghen/blink.cmp",
		version = "*",
		event = "InsertEnter",
		opts = {
			keymap = { preset = "super-tab" },
			sources = {
				default = { "lsp", "path", "buffer", "snippets", "minuet", "avante" },
				providers = {
					minuet = {
						name = "minuet",
						module = "minuet.blink",
						async = true,
						timeout_ms = 3000,
						score_offset = 50,
					},
					avante = {
						name = "avante",
						module = "blink-cmp-avante",
						score_offset = 100,
					},
				},
			},
			completion = {
				accept = { auto_brackets = { enabled = true } },
				documentation = { auto_show = true, auto_show_delay_ms = 500 },
				trigger = { prefetch_on_insert = false },
			},
			appearance = {
				kind_icons = {
					Ollama = "󰳆"
				}
			}
		},
		config = function(_, opts)
			local capabilities = {
				textDocument = {
					foldingRange = {
						dynamicRegistration = false,
						lineFoldingOnly = true,
					},
				},
			}
			local cmp = require("blink.cmp")
			capabilities = cmp.get_lsp_capabilities(capabilities)
			vim.lsp.config("*", capabilities)
			cmp.setup(opts)
		end,
		dependencies = {
			{
				"milanglacier/minuet-ai.nvim",
				name = "minuet",
				opts = {
					provider = "openai_compatible",
					n_completions = 1,
					context_window = 8000,
					provider_options = {
						openai_compatible = {
							name = "Ollama",
							end_point = "http://localhost:11434/v1/chat/completions",
							model = "qwen2.5-coder:3b-base-q4_K_M",
							api_key = "TERM",
						},
					},
				},
				dependencies = {
					"nvim-lua/plenary.nvim",
				},
			},
			"Kaiser-Yang/blink-cmp-avante",
		},
	},
	{
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		opts = {},
	},
	{
		"numToStr/Comment.nvim",
		event = { "BufReadPost", "BufNewFile" },
		opts = {},
	},
	{
		"nvim-treesitter/nvim-treesitter",
		build = ":TSUpdate",
		dependencies = {
			"nvim-treesitter/nvim-treesitter-refactor",
			"windwp/nvim-ts-autotag",
			{
				"nvim-treesitter/nvim-treesitter-context",
				main = "treesitter-context",
				opts = {
					max_lines = 5,
					min_window_height = 50,
					trim_scope = "inner",
					multiline_threshold = 1,
				},
			},
		},
		event = { "BufReadPost", "BufNewFile" },
		opts = {
			ensure_installed = "all",
			highlight = { enable = true },
			indent = { enable = true },
			refactor = {
				highlight_definitions = { enable = true },
				smart_rename = {
					enable = true,
					keymaps = { smart_rename = "grr" },
				},
			},
			autotag = {
				enable = true,
			},
		},
		main = "nvim-treesitter.configs",
	},
	{
		"folke/which-key.nvim",
		event = "VeryLazy",
		opts = {},
	},
	{
		"smjonas/inc-rename.nvim",
		name = "inc_rename",
		opts = {},
		keys = {
			{
				"<leader>rn",
				function()
					return ":IncRename " .. vim.fn.expand("<cword>")
				end,
				expr = true,
				desc = "Rename",
			},
		},
	},
	{
		"nmac427/guess-indent.nvim",
		event = { "BufReadPre", "BufNewFile" },
		cmd = "GuessIndent",
		opts = {},
	},
	{
		"nvim-pack/nvim-spectre",
		dependencies = {
			"nvim-lua/plenary.nvim",
		},
		keys = {
			{
				"<leader>S",
				function()
					require("spectre").toggle()
				end,
				desc = "Toggle Spectre",
			},
			{
				"<leader>sw",
				function()
					require("spectre").open_visual({ select_word = true })
				end,
				desc = "Search current word",
				mode = { "n", "v" },
			},
			{
				"<leader>sp",
				function()
					require("spectre").open_file_search({ select_word = true })
				end,
				desc = "Search on current file",
			},
		},
	},
	{
		"stevearc/conform.nvim",
		keys = {
			{
				"gq",
				function()
					require("conform").format({ async = true, lsp_fallback = true })
					vim.cmd("silent GuessIndent")
				end,
				mode = "",
				desc = "Format Buffer",
			},
		},
		opts = {
			formatters_by_ft = {
				lua = { "stylua" },
				python = { "isort", "black" },
				javascript = { "prettierd" },
				go = { "gofmt", "goimports" },
				markdown = { "prettierd" },
				yaml = { "yamlfmt" },
				["*"] = { "codespell" },
				["_"] = { "trim_whitespace" },
			},
		},
	},
	{
		"HiPhish/rainbow-delimiters.nvim",
		event = { "BufReadPost", "BufNewFile" },
		main = "rainbow-delimiters.setup",
		opts = {},
	},
	{
		"brenoprata10/nvim-highlight-colors",
		event = { "BufReadPost", "BufNewFile" },
		opts = {
			render = "virtual",
			enable_tailwind = true,
		},
	},
	{
		"yetone/avante.nvim",
		build = "make",
		cmd = { "AvanteAsk", "AvanteToggle", "AvanteChat" },
		keys = {
			{
				"<leader>aa",
				"<cmd>AvanteAsk<cr>",
				desc = "Ask Avante",
			},
		},
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
			"stevearc/dressing.nvim",
			"nvim-lua/plenary.nvim",
			"MunifTanjim/nui.nvim",
			"nvim-tree/nvim-web-devicons",
			{
				"HakonHarnes/img-clip.nvim",
				opts = {
					default = {
						embed_image_as_base64 = true,
						prompt_for_file_name = true,
						drag_and_drop = {
							insert_mode = true,
						},
					},
				},
			},
		},
		opts = {
			provider = "openai",
			openai = {
				endpoint = "https://api.kubecity.ai/v1",
				model = "openai/gpt-4.1",
				api_key_name = { "op", "read", "op://Personal/LiteLLM/api key" },
			},
		},
	},
	{
		"kevinhwang91/nvim-ufo",
		dependencies = {
			"kevinhwang91/promise-async",
			"williamboman/mason-lspconfig.nvim",
		},
		event = { "BufReadPre", "BufNewFile" },
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
}
