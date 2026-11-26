vim.pack.add({
	"https://github.com/nvim-lua/plenary.nvim",
	{ src = "https://github.com/mikavilpas/yazi.nvim", version = vim.version.range("*") },
})

require("yazi").setup({
	open_for_directories = false,
})

vim.keymap.set({ "n", "v" }, "<leader>yf", "<cmd>Yazi<cr>", { desc = "Open [Y]azi at the current [F]ile" })
vim.keymap.set("n", "<leader>yd", "<cmd>Yazi cwd<cr>", { desc = "Open [Y]azi in nvim's working [D]irectory" })
