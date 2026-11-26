vim.pack.add({
	"https://github.com/lewis6991/gitsigns.nvim",
	-- actively maintained drop-in fork of sindrets/diffview.nvim, whose
	-- upstream has been idle since 2024
	"https://github.com/dlyongemallo/diffview-plus.nvim",
})

require("gitsigns").setup({})

require("diffview").setup({
	view = {
		-- entered from lazygit purely to resolve, so skip the file panel
		merge_tool = { focus_diff = true },
	},
})
vim.keymap.set("n", "<leader>do", "<cmd>DiffviewOpen<cr>", { desc = "[D]iffview [O]pen" })
vim.keymap.set("n", "<leader>df", "<cmd>DiffviewFileHistory<cr>", { desc = "[D]iffview [F]ile History" })
