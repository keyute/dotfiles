-- Project-wide find & replace
vim.pack.add({ "https://github.com/MagicDuck/grug-far.nvim" })

require("grug-far").setup({
	engines = {
		ripgrep = {
			extraArgs = "--hidden --glob=!**/.git/*",
		},
	},
})

vim.keymap.set("n", "<leader>rr", function()
	require("grug-far").open()
end, { desc = "[R]eplace in p[r]oject (grug-far)" })
vim.keymap.set("n", "<leader>rf", function()
	require("grug-far").open({ prefills = { paths = vim.fn.expand("%") } })
end, { desc = "[R]eplace in [F]ile (grug-far)" })
vim.keymap.set("x", "<leader>r", function()
	require("grug-far").with_visual_selection()
end, { desc = "[R]eplace selection (grug-far)" })
