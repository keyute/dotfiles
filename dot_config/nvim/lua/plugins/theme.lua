return {
	{
		"marko-cerovac/material.nvim",
		priority = 1000,
		config = function()
			vim.o.termguicolors = true
			if vim.fn.has("macunix") == 1 then
				local handle = io.popen("defaults read -g AppleInterfaceStyle 2>&1")
				if handle then
					local result = handle:read("*a")
					handle:close()
					if result:match("^Dark") then
						vim.g.material_style = "darker"
					else
						vim.g.material_style = "lighter"
					end
				end
			else
				vim.g.material_style = "darker"
			end
			vim.cmd.colorscheme("material")
			require("material").setup({
				plugins = {
					"indent-blankline",
					"nvim-tree",
					"nvim-web-devicons",
					"gitsigns",
					"telescope",
					"which-key",
				},
				contrast = {
					sidebars = true,
					floating_windows = true,
					cursor_line = true,
				},
			})
		end,
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
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣀⣀⣤⣤⣴⣶⣶⣦⣤⣤⣀⣀⡀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣀⣠⣤⣴⣶⣾⣿⣿⣶⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⡀⠀⠀⢀⣀⣠⣤⣄⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢿⢿⡿⣿⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢿⣟⣿⡽⣯⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣦⣄⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣴⣿⣿⣿⣿⣿⣟⣯⡿⣽⣾⣷⣿⣾⣾⣿⣿⢽⣯⣿⣷⣟⣾⣳⣯⢷⣟⣷⣻⣽⣿⣿⣿⢿⣳⡿⣾⣽⣿⣿⣿⣾⡿⣽⣞⡿⣟⣿⢽⡾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⡿⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢰⣿⣿⣿⣿⣻⢽⣻⣾⣽⣿⣾⣷⣿⣾⣻⣗⡿⣽⣺⣻⢷⣯⣷⢿⢾⣿⣞⣗⣟⣾⣾⣳⢯⢿⣗⣟⣗⣯⣷⣿⣗⡯⣟⣗⡯⡯⣿⣾⣽⣯⣿⣗⡯⣿⢽⣻⣻⢿⢿⢿⡿⣗⡿⣽⣻⣯⣟⣿⣻⣿⣿⣿⣧⠀⠀⠀
⠀⠀⠀⠀⣀⣠⣤⣾⣿⣿⣿⣿⣾⡽⣾⣻⢿⣻⢯⣗⣟⣾⣾⣾⣽⣷⣷⣯⣿⣽⡽⡽⣽⣺⣿⣾⣾⣷⢗⡯⣯⣿⣗⡯⡾⣝⣗⢿⣿⣯⣷⣷⢯⢯⣗⣟⢾⢽⣷⣯⣯⣯⣻⢮⢯⢯⢯⢷⣿⣗⡯⣗⡿⣽⣻⢿⣾⣿⣿⣿⡿⠀⠀⠀
⠀⣴⣾⣿⣿⣿⣿⣿⣿⡿⣿⣻⣻⣟⢯⢯⡻⣮⣳⣳⠳⠯⡯⣯⢿⣽⣿⣿⣽⢯⢯⡻⣮⣿⣿⣿⣽⣽⣷⣽⣾⣽⡷⡽⣝⣞⣮⣷⣯⢯⢯⢿⣯⣗⣷⣽⣽⣷⣯⣿⣽⣽⣿⣿⣻⣽⣯⣟⣟⣮⣻⣺⣽⡺⡮⣯⣿⣿⣿⡿⠃⠀⠀⠀
⣼⣿⣿⣿⡿⣟⣿⣿⣿⡿⡾⣿⣞⣯⣯⣳⣻⣾⣽⡇⠅⡂⡂⡂⠅⠌⡊⠫⡻⣿⣳⣟⣯⣿⣻⣻⣻⠿⠿⠽⡯⣟⣯⣟⣯⣟⢏⢣⠡⡣⡑⡑⡌⢎⢻⣯⣟⣿⣽⣻⢽⢿⣽⣿⣿⣿⡿⣿⣟⢞⡮⣾⣿⣿⣿⣿⣿⣿⠟⠁⠀⠀⠀⠀
⢸⣿⣿⣿⣽⡺⡮⡿⡽⡽⡽⡽⣿⢿⡿⣿⢿⡿⣿⠂⠅⡂⡂⡂⠅⠅⡂⠅⡂⠍⢿⣿⢿⡿⢛⠉⠄⢂⠡⠐⡀⢉⢻⣿⡿⡑⡌⢆⠕⣴⢼⣌⢢⠱⡐⢝⡿⣿⢿⢝⣵⠷⡵⣝⣝⢽⢝⣿⣾⣷⣽⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠀⠀⠀
⠀⢿⣿⣿⣷⢯⣫⣻⣽⣾⣿⣿⣿⣿⣿⣿⣿⣿⡗⢈⢂⢂⠢⢰⣿⣆⠂⠅⡂⠅⡊⣿⡿⠁⠄⠂⠌⣤⣄⠅⡐⡀⠂⣻⡏⡆⢕⢡⢹⣿⣿⣿⠥⡱⡘⠔⣿⢯⣪⠟⢌⡢⠫⣹⡞⣕⢧⢻⠿⡎⣗⢝⢾⣾⣿⣿⣿⣷⠀⠀⠀⠀⠀⠀
⠀⠸⣿⣿⣿⣗⣗⣗⣟⣟⢮⣗⣗⣯⣷⣯⣿⣿⠠⢁⠢⠐⠄⣷⣯⡿⠈⠔⠠⡁⡂⣿⡇⠡⠈⠌⢸⣯⡐⢐⠀⡂⢡⣼⣗⢜⢐⠕⢌⠻⢝⠏⡕⢔⠜⢬⢯⣪⣎⢯⡳⡻⡜⡖⣝⢜⢵⢵⡝⠞⢯⢷⣇⡏⡿⣿⣿⣿⣧⠀⠀⠀⠀⠀
⠀⠀⢻⣿⣿⣿⣞⢮⣺⢮⡷⣷⡷⣿⣿⣿⣿⢇⢊⢐⠨⠨⢰⣿⣿⡏⠌⠌⡂⡂⢢⣿⣷⠈⠄⡁⡂⠛⠷⠴⠶⢿⣿⣿⣿⣧⡕⡡⠣⡑⡅⢕⠌⣆⣵⡿⣕⣗⡯⡷⡯⣗⣟⡮⡪⢮⡪⡻⣽⣎⣢⡹⡞⣝⡜⡽⣿⣿⣿⣆⠀⠀⠀⠀
⠀⠀⠈⣿⣿⣿⣿⣿⣾⣿⣿⣷⣿⣷⣿⣿⣾⣧⣦⣆⣌⡌⣾⣾⣾⣧⠡⡁⡂⡂⠢⢷⣿⣧⣐⠀⡂⠡⠈⠄⡁⣾⣷⣷⣷⣿⣽⣷⣷⣵⣮⣶⣿⣾⣷⢯⣺⣺⢽⢯⣟⡽⡾⣝⢎⢗⢽⢜⢜⣎⢮⣪⢾⣺⢽⡪⡻⣿⣿⣿⡄⠀⠀⠀
⠀⠀⠀⠘⠿⣿⣿⣿⣿⣿⣿⣿⣿⣽⣯⣿⣽⣯⣿⣽⣯⣿⣿⣻⣻⣻⣷⣐⡐⣨⣰⡽⣯⣟⣟⣷⣦⣥⣥⣥⣖⣿⡽⣿⠋⠅⢁⠉⢿⣻⣻⣻⣻⣻⣻⣳⣵⣕⣽⢹⡺⣝⢯⢷⢕⠽⡵⡝⡎⣾⣫⡯⣟⣞⡯⣿⡸⢽⣿⣿⣿⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠈⢩⣿⣿⣿⡟⡮⠮⡮⡺⡼⣜⢜⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣯⠀⠅⠐⠠⢨⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣷⣷⣽⣮⣧⢳⢹⢜⢾⢵⣻⢽⡺⡝⣕⣽⣾⣿⣿⣿⡀⠀⠀
⠀⠀⠀⠀⠀⠀⢠⣿⣿⣿⡟⡮⡎⢥⠍⡫⡯⡪⡪⣎⢟⢮⡫⡯⡻⣝⢗⣯⣷⣯⡏⢕⢑⠔⡰⣹⣷⣯⣷⢋⡓⠯⡿⣞⣧⡬⡨⠔⠾⣽⣽⣽⣽⣽⣿⣿⣾⣷⣻⣾⣳⣿⣞⣷⣷⣯⣷⣕⢕⢟⢝⣎⣧⣷⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀
⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⢕⡝⡎⡗⡝⣎⢇⢏⢮⢺⣺⢯⠏⡭⣟⢮⡳⡹⣟⣿⣻⡐⢅⠪⡐⠜⣿⡿⠣⡑⢌⠪⢨⣺⣯⠠⠐⢀⠂⢿⢿⡟⡙⠍⠕⡡⢑⠍⠣⠡⠡⢊⠌⠫⡻⡿⡿⡿⡷⡿⡻⡿⣟⣿⠏⠅⠡⡁⠅⡙⢿⣿⣿⣧
⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⢸⢮⢯⡫⣯⡺⡵⡹⣪⡫⡳⡵⡵⡻⡏⡧⡫⡮⣻⣿⣿⣧⢑⢌⠢⡑⠽⡃⠕⢌⠢⡡⣳⣿⣾⡂⢈⠠⠀⢽⣿⣗⠡⡡⢑⢨⠐⢌⠊⢌⠪⡐⠌⢌⢂⢝⣿⣿⢻⢘⢌⢎⢺⡿⢂⠡⠑⠄⢕⠠⣽⣿⣿⡿
⠀⠀⠀⠀⠀⠀⣿⣿⣿⡿⡸⡽⣕⢯⣞⢞⡽⣚⢾⢽⣻⣺⣞⣽⢪⡫⣝⢞⢮⣷⣟⣾⡆⢆⠕⢌⠪⠨⡊⡢⢑⣼⣯⣯⣯⣇⠀⢂⠁⠌⣿⣗⠅⡢⢁⢪⣿⠠⡡⢑⠨⣿⡨⢂⢂⢂⢿⢨⠢⡣⡱⠨⡊⠔⡐⠄⠡⡑⢡⣾⣿⣿⣿⠃
⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣮⣣⣫⣕⣕⣝⣝⢜⣯⣟⡾⡵⣗⡯⣇⢯⡺⣜⣟⣟⣟⣟⣿⡐⢅⠕⢌⠪⡐⢬⣞⣟⣿⣿⣻⣗⠈⠠⠀⠅⢿⣻⠐⠌⢔⢨⣿⠡⡂⢅⠊⣟⡆⢅⠢⠡⠹⣧⣧⣱⣘⢌⢊⢂⠂⢅⠕⣾⣿⣿⣿⡿⠃⠀
⠀⠀⠀⠀⠀⠀⠈⠿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣷⣵⣕⡽⡝⣗⢟⢧⡳⡵⣿⢿⣿⢿⣿⢿⡷⣅⣊⣢⣱⣼⣿⢿⣿⣿⣿⢿⣿⣦⣵⢾⣾⣿⣿⠨⢊⠔⡐⣿⢕⠨⢠⠡⣻⡿⣆⡊⢌⣢⣾⣿⣿⣿⣿⣶⣤⣅⣅⣦⣿⣿⣿⡏⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠙⠛⠛⠛⠻⣿⣿⣿⣿⣿⣿⣿⣾⣿⣾⣾⣽⣾⣿⣾⣿⣾⣿⣽⣯⣿⣿⣿⣷⣯⣿⣾⣾⣾⣿⣾⣾⣾⣿⣾⣿⣿⣷⣷⣷⣷⣿⣷⣿⣷⣿⣷⣿⣷⣿⣷⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠛⠻⠿⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠋⠀⠉⠛⠛⠛⠛⠋⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠀⠀⠀⠉⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
			]]
			logo = string.rep("\n", 3) .. logo .. string.rep("\n", 3)
			opts.config.header = vim.split(logo, "\n")
			require("dashboard").setup(opts)
		end,
	},
	{
		"f-person/auto-dark-mode.nvim",
		event = "VeryLazy",
		config = function()
			if vim.fn.has("macunix") == 0 then
				return
			end
			require("auto-dark-mode").setup({
				update_interval = 1000,
				set_dark_mode = function()
					require("material.functions").change_style("darker")
				end,
				set_light_mode = function()
					require("material.functions").change_style("lighter")
				end,
			})
		end,
	},
}
