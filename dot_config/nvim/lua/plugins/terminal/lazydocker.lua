return {
	"crnvl96/lazydocker.nvim",
	keys = {
		{
			"<leader>ld",
			function()
				require("lazydocker").toggle({ engine = "docker" })
			end,
			desc = "Open [L]azy[D]ocker",
		},
	},
	opts = {},
}
