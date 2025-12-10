return {
	"saghen/blink.cmp",
	event = "VimEnter",
	version = "1.*",
	dependencies = {
		-- Snippet Engine
		{
			"L3MON4D3/LuaSnip",
			version = "2.*",
			build = (function()
				if vim.fn.has("win32") == 1 or vim.fn.executable("make") == 0 then
					return
				end
				return "make install_jsregexp"
			end)(),
			dependencies = {
				{
					"rafamadriz/friendly-snippets",
					config = function()
						require("luasnip.loaders.from_vscode").lazy_load()
					end,
				},
			},
			opts = {},
		},
		"folke/lazydev.nvim",
		"Kaiser-Yang/blink-cmp-avante",
	},
	--- @module 'blink.cmp'
	--- @type blink.cmp.Config
	opts = {
		keymap = {
			preset = "super-tab",
		},
		appearance = {
			nerd_font_variant = "mono",
		},
		completion = {
			documentation = { auto_show = true, auto_show_delay_ms = 500 },
			trigger = { prefetch_on_insert = false },
		},
		sources = {
			default = { "avante", "lsp", "path", "snippets", "lazydev", "minuet" },
			providers = {
				lazydev = { module = "lazydev.integrations.blink", score_offset = 100 },
				avante = { module = "blink-cmp-avante", name = "Avante" },
				minuet = {
					module = "minuet.blink",
					name = "Minuet",
					async = true,
					timeout_ms = 3000,
					score_offset = 50,
				},
			},
		},
		snippets = { preset = "luasnip" },
		fuzzy = { implementation = "lua" },
		signature = { enabled = true },
	},
}
