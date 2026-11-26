vim.pack.add({
	"https://github.com/saghen/blink.lib",
	{ src = "https://github.com/saghen/blink.pairs", version = vim.version.range("*") },
})

-- no-op once the prebuilt binary is present
require("blink.pairs").download():pwait(60000)

require("blink.pairs").setup({
	mappings = { enabled = true },
	highlights = {
		enabled = true,
		groups = {
			"BlinkPairsOrange",
			"BlinkPairsPurple",
			"BlinkPairsBlue",
		},
	},
})
