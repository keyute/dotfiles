return {
	"saghen/blink.pairs",
	version = "*",
	dependencies = "saghen/blink.lib",
	build = function()
		require("blink.pairs").download():pwait(60000)
	end,
	opts = {
		mappings = { enabled = true },
		highlights = {
			enabled = true,
			groups = {
				"BlinkPairsOrange",
				"BlinkPairsPurple",
				"BlinkPairsBlue",
			},
		},
	},
}
