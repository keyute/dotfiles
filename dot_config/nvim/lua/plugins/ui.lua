vim.o.mouse = "a"
vim.o.mousemoveevent = true
vim.o.showmode = false
vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]
vim.o.foldcolumn = "1"
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.wo.numberwidth = 1
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

return {
	{
		"akinsho/bufferline.nvim",
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
		event = { "BufReadPre", "BufNewFile" },
		opts = {
			options = {
				close_icon = "",
				modified_icon = "●",
				buffer_close_icon = "󰅖",
				left_trunc_marker = "",
				right_trunc_marker = "",
				hover = {
					enabled = true,
					delay = 0,
					reveal = { "close" },
				},
				diagnostics = "nvim_lsp",
				diagnostics_indicator = function(count, level, _, _)
					local icon = level:match("error") and " " or " "
					return " " .. icon .. count
				end,
			},
		},
	},
	{
		"Bekaboo/dropbar.nvim",
		event = { "BufReadPost", "BufWritePost", "BufNewFile" },
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
	},
	{
		"lukas-reineke/indent-blankline.nvim",
		event = { "BufReadPost", "BufNewFile" },
		main = "ibl",
		opts = {
			indent = {
				char = "▏",
			},
			scope = {
				show_start = false,
				show_end = false,
			},
		},
	},
	{
		"nvim-lualine/lualine.nvim",
		dependencies = {
			"nvim-tree/nvim-web-devicons",
			"AndreM222/copilot-lualine",
		},
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local function is_markdown()
				return vim.bo.filetype == "markdown" or vim.bo.filetype == "asciidoc"
			end
			local function wordcount()
				return tostring(vim.fn.wordcount().words) .. " words"
			end
			local function indentation()
				if vim.o.expandtab then
					return tostring(vim.o.shiftwidth) .. " spaces"
				else
					return "Tab"
				end
			end
			require("lualine").setup({
				options = {
					theme = "material",
					section_separators = "",
					component_separators = "|",
				},
				sections = {
					lualine_x = {
						"copilot",
						indentation,
						"encoding",
						"fileformat",
						"filetype",
						{ wordcount, cond = is_markdown },
					},
				},
			})
		end,
	},
	{
		"luukvbaal/statuscol.nvim",
		dependencies = {
			{
				"lewis6991/gitsigns.nvim",
				opts = {},
			},
		},
		event = { "BufReadPre", "BufNewFile" },
		config = function()
			local builtin = require("statuscol.builtin")
			require("statuscol").setup({
				relculright = true,
				segments = {
					{ text = { "%s" }, click = "v:lua.ScSa" },
					{ text = { builtin.lnumfunc, " " }, click = "v:lua.ScLa" },
					{ text = { builtin.foldfunc, " " }, click = "v:lua.ScFa" },
				},
			})
		end,
	},
	{
		"folke/noice.nvim",
		event = "VeryLazy",
		opts = {
			presets = {
				inc_rename = true,
				long_message_to_split = true,
				bottom_search = true,
				command_palette = true,
			},
			lsp = {
				progress = {
					enabled = false,
				},
			},
		},
		dependencies = {
			"MunifTanjim/nui.nvim",
			"rcarriga/nvim-notify",
		},
	},
	{
		"mikavilpas/yazi.nvim",
		dependencies = {
			"nvim-lua/plenary.nvim",
			keys = {
				{
					"<leader>e",
					function()
						require("yazi").yazi()
					end,
					desc = "File Manager",
				},
			},
		}
	},
}
