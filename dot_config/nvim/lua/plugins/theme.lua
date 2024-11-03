return {
	{
		"catppuccin/nvim",
		name = "catppuccin",
		priority = 1000,
		config = function()
			require("catppuccin").setup({
				integrations = {
					dropbar = {
						enabled = true,
					},
					indent_blankline = {
						enabled = true,
						colored_indent_levels = true,
					},
				},
			})
			vim.cmd.colorscheme("catppuccin")
		end,
	},
	{
		"f-person/auto-dark-mode.nvim",
		event = "VeryLazy",
		opts = {
			update_interval = 1000,
			set_dark_mode = function()
				vim.o.background = "dark"
				vim.cmd("colorscheme catppuccin")
			end,
			set_light_mode = function()
				vim.o.background = "light"
				vim.cmd("colorscheme catppuccin")
			end,
		},
	},
	{
		"glepnir/dashboard-nvim",
		event = "VimEnter",
		opts = {
			shortcut_type = "number",
			config = {
				packages = { enable = false },
				shortcut = {
					{
						icon = "󰱼",
						desc = " Files ",
						group = "Label",
						action = "Telescope find_files",
						key = "f",
					},
					{
						icon = "󱎸",
						desc = " Grep ",
						group = "Number",
						action = "Telescope live_grep",
						key = "g",
					},
				},
				footer = {},
			},
			hide = { tabline = false },
		},
		dependencies = {
			"nvim-tree/nvim-web-devicons",
		},
		config = function(_, opts)
			local logo = [[
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⣀⣤⣴⣶⣶⣶⣶⣤⣤⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣤⣤⣶⣾⣿⣿⣶⣄⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣿⣿⣿⣿⣿⣿⣷⣤⣤⣤⣤⣶⣶⣶⣤⣄⣀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⢠⣶⣿⣿⣿⣿⢿⣟⣿⣻⣟⣯⣿⣽⢯⣟⣿⣻⣟⣿⣻⣟⡿⣟⣿⣿⣿⣻⣟⣿⣿⣿⡿⣽⢷⣯⡿⣿⣟⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣄⠀⠀⠀
⠀⠀⠀⠀⠀⠀⣿⣿⣿⣟⡿⣽⣯⣯⣿⣽⣿⣻⢯⢿⢽⣻⣯⣷⣟⡾⣷⢯⢿⣽⡯⣟⣯⣷⣻⣞⣯⣿⣻⣻⡽⡾⣽⣗⣿⣞⣯⣟⣟⣟⡿⡿⣿⢿⡯⡷⣯⣿⣻⡿⣿⣿⣿⡆⠀⠀
⠀⠀⣀⣠⣤⣶⣿⣿⣿⣷⣯⡷⣟⣟⡯⣗⢿⣾⣿⣽⣿⣾⣾⡷⡯⡯⣿⣿⣿⡾⣽⡳⣿⣞⣞⣞⣗⢿⣿⣾⣯⡻⡮⣗⣟⢾⣷⣷⣯⣾⡽⣽⡺⣿⡯⡯⣗⣟⣟⣿⣿⣿⣿⡇⠀⠀
⢠⣿⣿⣿⣿⣿⣿⣟⣯⣯⡯⣯⣳⣳⣽⡏⡙⠕⠻⠺⢻⢿⣾⡽⡽⣽⣿⣿⣾⣿⣾⢿⣽⣞⣞⣾⢾⢟⢞⠳⡛⠿⣽⣾⣾⣿⣷⣿⣾⣿⣿⣷⣿⣿⡺⣝⣷⣷⣳⣷⣿⣿⠟⠀⠀⠀
⢻⣿⣿⣯⣳⣻⣟⡯⡯⣷⣿⣷⣷⣿⣾⢂⠢⠡⠡⢑⠐⢄⠙⢿⣿⣿⣾⠞⠓⡉⠌⢉⠛⣾⣿⡞⡱⡐⢅⢕⡘⡌⡢⢻⣾⣷⡟⣞⣞⣝⢟⢿⢽⣗⣯⣳⣿⣿⣿⣿⡿⠃⠀⠀⠀⠀
⠘⣿⣿⣷⣳⡳⣷⣽⣯⣷⣿⣷⣿⣷⡏⠔⠨⢐⢱⣦⡊⡐⠨⡀⢷⡿⠂⡈⠄⣢⡈⠄⢂⠈⣿⢌⠢⡊⣾⣿⣿⠔⢅⠕⣷⢳⠽⡃⡲⢙⣯⢳⣓⢿⢯⣫⢻⣽⣿⣿⣿⡀⠀⠀⠀⠀
⠀⢹⣿⣿⣞⢮⣻⡳⣽⡺⣽⣾⣿⣿⠨⠨⠨⠐⣼⣿⡢⢈⢂⠂⢽⡇⠡⠐⠨⣯⠠⢁⢂⣰⣽⡜⢌⢊⠪⡛⢝⢘⢔⢱⣝⢮⢯⡺⡳⡕⣇⠧⡧⣗⡓⡫⡷⣕⡻⣿⣿⣷⠀⠀⠀⠀
⠀⠈⣿⣿⣿⣽⣺⣽⣗⣿⣻⣿⣟⡧⡡⠡⠡⢱⣟⣿⡐⡐⠄⠅⢿⣻⡀⠅⠡⠘⡙⢚⢹⡿⣿⣟⣮⣜⢌⡪⣨⣢⣞⡿⣜⣯⢯⢿⣝⡯⡎⣞⡜⣝⠷⡔⣏⢧⣳⡹⣿⣿⣧⠀⠀⠀
⠀⠀⠘⣿⣿⣿⣿⣿⣿⣿⢿⣻⢿⢿⢿⣻⢾⣾⢿⢿⣧⡠⠑⡨⡸⡿⣿⢦⣅⣂⣂⣂⡾⣿⣿⠛⠛⠻⣿⢿⡿⡿⡿⣯⡺⡺⡫⣟⢾⣽⡪⡺⡪⡎⣗⣟⣞⡯⣗⣧⢻⣿⣿⡇⠀⠀
⠀⠀⠀⠀⠉⠉⣿⣿⣿⢏⢯⣫⡫⣏⢟⢿⣿⣿⣿⣿⣿⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡃⡈⠄⠁⢽⣿⣿⣿⣿⣿⣿⣿⣿⣾⣵⣮⣞⣜⢝⡕⡽⣞⣗⢿⢝⢎⣷⣿⣿⣟⠀⠀
⠀⠀⠀⠀⠀⣼⣿⣿⢏⡮⣱⡈⡯⡎⡮⡫⣫⡽⣝⣝⢗⢿⣾⣽⡑⡑⢔⢸⣽⣾⡗⢍⠗⢿⣷⠦⠢⢑⢻⣽⣽⣽⡿⡿⣾⣷⢿⠾⡷⣿⣾⣽⣧⡳⡹⣣⣧⣷⣿⡿⡿⡿⣿⣿⣷⡄
⠀⠀⠀⠀⠀⣿⣿⣿⢸⣪⢮⡪⣇⢗⢵⢽⡳⣋⣖⡯⣳⡹⣽⣻⣎⢌⠢⡂⣻⡏⡊⡢⢡⢱⣽⡆⠈⠄⠸⣻⡏⠔⡡⢊⢐⠄⠕⡨⢐⢐⠙⣟⣟⣟⢟⠝⢯⣿⡃⡐⡐⡐⡈⣿⣿⣿
⠀⠀⠀⠀⠀⣿⣿⣟⢼⢮⡳⣽⡺⡕⣗⡷⡽⣜⣮⢺⡪⣎⢟⣟⣿⡢⡑⢌⢌⠢⡑⢌⢢⣿⣻⡧⠈⡐⠈⣿⡯⠨⡐⢔⡦⢊⠌⡐⣇⠢⢑⠨⣟⢕⠕⡍⢆⠫⢐⠀⠢⡂⣲⣿⣿⡟
⠀⠀⠀⠀⠀⣿⣿⣷⣭⣳⣹⣚⣎⢯⢾⢽⣽⡳⣯⡺⡪⡮⣟⣿⣻⢷⡨⢂⠆⠕⢌⣲⣟⣿⣿⣻⠀⡐⠀⢽⣟⠨⡐⢌⣿⠠⡑⡨⣿⢈⠢⠡⢳⣥⣣⡊⡆⡃⡂⠅⢵⣾⣿⣿⠟⠀
⠀⠀⠀⠀⠀⠙⢿⣿⣿⣿⣿⣿⣿⣷⣽⣕⣗⢯⡳⡫⡮⡿⡿⡿⡿⡿⣧⣕⣬⣪⡾⡿⡿⡿⡿⡿⣧⢶⡷⣿⣷⢁⡊⣐⢿⣐⣐⣐⢿⣳⣌⢌⡶⣿⣿⣿⣷⣶⣤⣕⣾⣿⣿⠋⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠙⠻⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠻⢿⣿⣿⣿⠟⠁⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠛⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
			]]
			local spacing = 2
			logo = string.rep("\n", spacing) .. logo .. string.rep("\n", spacing)
			opts.config.header = vim.split(logo, "\n")
			require("dashboard").setup(opts)
		end,
	},
}
