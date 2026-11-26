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

vim.pack.add({ "https://github.com/folke/snacks.nvim" })

---@type snacks.Config
local opts = {
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
		-- Default sections minus "startup" (the "loaded N/M plugins" line)
		sections = {
			{ section = "header" },
			{ section = "keys", gap = 1, padding = 1 },
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
}
require("snacks").setup(opts)

-- stylua: ignore start
vim.keymap.set("n", "<leader><space>", function() Snacks.picker.files() end, { desc = "Find Files" })
vim.keymap.set("n", "<leader>ff", function() Snacks.picker.files() end, { desc = "[F]ind [F]iles" })
vim.keymap.set("n", "<leader>fr", function() Snacks.picker.recent() end, { desc = "[F]ind [R]ecent Files" })
vim.keymap.set("n", "<leader>fc", function() Snacks.picker.files({ cwd = vim.fn.stdpath("config") }) end, { desc = "[F]ind [C]onfig File" })
vim.keymap.set("n", "<leader>,", function() Snacks.picker.buffers() end, { desc = "Buffers" })
vim.keymap.set("n", "<leader>bd", function() Snacks.bufdelete() end, { desc = "[B]uffer [D]elete" })
vim.keymap.set("n", "<leader>sg", function() Snacks.picker.grep() end, { desc = "[S]earch by [G]rep" })
vim.keymap.set({ "n", "x" }, "<leader>sw", function() Snacks.picker.grep_word() end, { desc = "[S]earch current [W]ord" })
vim.keymap.set("n", "<leader>sb", function() Snacks.picker.lines() end, { desc = "[S]earch [B]uffer Lines" })
vim.keymap.set("n", "<leader>sB", function() Snacks.picker.grep_buffers() end, { desc = "[S]earch Open [B]uffers" })
vim.keymap.set("n", "<leader>sh", function() Snacks.picker.help() end, { desc = "[S]earch [H]elp" })
vim.keymap.set("n", "<leader>sk", function() Snacks.picker.keymaps() end, { desc = "[S]earch [K]eymaps" })
vim.keymap.set("n", "<leader>sd", function() Snacks.picker.diagnostics() end, { desc = "[S]earch [D]iagnostics" })
vim.keymap.set("n", "<leader>sR", function() Snacks.picker.resume() end, { desc = "[S]earch [R]esume" })
vim.keymap.set("n", "<leader>su", function() Snacks.picker.undo() end, { desc = "[S]earch [U]ndotree" })
-- stylua: ignore end
