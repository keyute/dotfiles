return {
	"brianhuster/live-preview.nvim",
	dependencies = {
		"nvim-telescope/telescope.nvim",
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
			picker = "telescope",
		})
	end,
}
