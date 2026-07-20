local header = table.concat({
	[[                                                                       ]],
	[[  ██████   █████                   █████   █████  ███                  ]],
	[[ ░░██████ ░░███                   ░░███   ░░███  ░░░                   ]],
	[[  ░███░███ ░███   ██████   ██████  ░███    ░███  ████  █████████████   ]],
	[[  ░███░░███░███  ███░░███ ███░░███ ░███    ░███ ░░███ ░░███░░███░░███  ]],
	[[  ░███ ░░██████ ░███████ ░███ ░███ ░░███   ███   ░███  ░███ ░███ ░███  ]],
	[[  ░███  ░░█████ ░███░░░  ░███ ░███  ░░░█████░    ░███  ░███ ░███ ░███  ]],
	[[  █████  ░░█████░░██████ ░░██████     ░░███      █████ █████░███ █████ ]],
	[[ ░░░░░    ░░░░░  ░░░░░░   ░░░░░░       ░░░      ░░░░░ ░░░░░ ░░░ ░░░░░  ]],
	[[                                                                       ]],
}, "\n")

return {
	"folke/snacks.nvim",
	priority = 1000,
	lazy = false,
	---@type snacks.Config
	opts = {
		picker = {
			ui_select = true,
			sources = {
				files = { hidden = true, exclude = { ".git" } },
				grep = { hidden = true, exclude = { ".git" } },
				grep_word = { hidden = true, exclude = { ".git" } },
				grep_buffers = { hidden = true, exclude = { ".git" } },
			},
		},
		dashboard = {
			preset = {
				header = header,
			},
		},
		indent = {
			indent = {
				hl = {
					"RainbowRed",
					"RainbowYellow",
					"RainbowBlue",
					"RainbowOrange",
					"RainbowGreen",
					"RainbowViolet",
					"RainbowCyan",
				},
			},
		},
		input = {},
		notifier = {},
	},
	-- stylua: ignore
	keys = {
		{ "<leader><space>", function() Snacks.picker.files() end, desc = "Find Files" },
		{ "<leader>ff", function() Snacks.picker.files() end, desc = "[F]ind [F]iles" },
		{ "<leader>fr", function() Snacks.picker.recent() end, desc = "[F]ind [R]ecent Files" },
		{ "<leader>fc", function() Snacks.picker.files({ cwd = vim.fn.stdpath("config") }) end, desc = "[F]ind [C]onfig File" },
		{ "<leader>,", function() Snacks.picker.buffers() end, desc = "Buffers" },
		{ "<leader>sg", function() Snacks.picker.grep() end, desc = "[S]earch by [G]rep" },
		{ "<leader>sw", function() Snacks.picker.grep_word() end, desc = "[S]earch current [W]ord", mode = { "n", "x" } },
		{ "<leader>sb", function() Snacks.picker.lines() end, desc = "[S]earch [B]uffer Lines" },
		{ "<leader>sB", function() Snacks.picker.grep_buffers() end, desc = "[S]earch Open [B]uffers" },
		{ "<leader>sh", function() Snacks.picker.help() end, desc = "[S]earch [H]elp" },
		{ "<leader>sk", function() Snacks.picker.keymaps() end, desc = "[S]earch [K]eymaps" },
		{ "<leader>sd", function() Snacks.picker.diagnostics() end, desc = "[S]earch [D]iagnostics" },
		{ "<leader>sR", function() Snacks.picker.resume() end, desc = "[S]earch [R]esume" },
		{ "<leader>su", function() Snacks.picker.undo() end, desc = "[S]earch [U]ndotree" },
	},
}
