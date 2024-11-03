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
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		dependencies = {
			"hrsh7th/nvim-cmp",
		},
		config = function()
			local cmp_autopairs = require("nvim-autopairs.completion.cmp")
			local cmp = require("cmp")
			cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())
			require("nvim-autopairs").setup({
				check_ts = true,
				enable_check_bracket_line = true,
				ignored_next_char = "[%w%.]",
			})
		end,
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
			"<leader>aa",
			"<cmd>AvanteToggle<cr>",
			desc = "Toggle Avante",
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
				api_key_name = { "op", "read", "op://Personal/Anthropic/api key" },
			},
		},
	},
}
