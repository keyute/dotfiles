return {
	"saghen/blink.pairs",
	version = "*",
	dependencies = "saghen/blink.download",
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
