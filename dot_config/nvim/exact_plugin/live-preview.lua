vim.pack.add({ "https://github.com/brianhuster/live-preview.nvim" })

require("livepreview.config").set({
	dynamic_root = true,
})

vim.keymap.set("n", "<leader>lp", function()
	vim.cmd("LivePreview close")
	vim.cmd("LivePreview start")
end, { desc = "Open [L]ive [P]review" })
