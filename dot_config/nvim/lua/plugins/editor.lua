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
				default = { "lsp", "path", "buffer", "snippets", "minuet" },
				providers = {
					minuet = {
						name = "minuet",
						module = "minuet.blink",
						score_offset = 8,
					},
				},
			},
			completion = {
				accept = { auto_brackets = { enabled = true } },
				documentation = { auto_show = true, auto_show_delay_ms = 500 },
			},
		},
		dependencies = {
			"milanglacier/minuet-ai.nvim",
			name = "minuet",
			opts = {
				provider = "openai_fim_compatible",
				n_completions = 1,
				context_window = 8000,
				provider_options = {
					openai_fim_compatible = {
						api_key = "TERM",
						name = "Qwen2.5 Coder",
						end_point = "http://localhost:11434/v1/completions",
						model = "qwen2.5-coder:3b-base-q8_0",
					},
				},
			},
			dependencies = {
				"nvim-lua/plenary.nvim",
			},
		},
	},
	{
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		opts = {},
	},
	{
		"numToStr/Comment.nvim",
		event = "VeryLazy",
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
		event = "VeryLazy",
		config = function()
			require("inc_rename").setup()
			vim.keymap.set("n", "<leader>rn", function()
				return ":IncRename " .. vim.fn.expand("<cword>")
			end, { expr = true, desc = "IncRename" })
		end,
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
		},
		opts = {
			provider = "claude",
			claude = {
				endpoint = "https://api.anthropic.com",
				model = "claude-3-7-sonnet-latest",
				api_key_name = { "op", "read", "op://Personal/Anthropic/api key" },
			},
		},
	},
}
