return {
	"brianhuster/live-preview.nvim",
	dependencies = {
		"folke/snacks.nvim",
	},
	cmd = { "LivePreview" },
	keys = {
		{
			"<leader>lp",
			function()
				vim.cmd("LivePreview close")
				vim.cmd("LivePreview start")
			end,
			desc = "Open [L]ive [P]review",
		},
	},
	config = function()
		require("livepreview.config").set({
			dynamic_root = true,
		})
	end,
}
