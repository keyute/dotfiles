return {
	"Bekaboo/dropbar.nvim",
	-- lazy-loading is unneeded, done upstream in plugin/dropbar.lua
	-- dropbar has its own built-in menu fuzzy finder; telescope-fzf-native is
	-- optional and only swaps in fzf-native's sort algorithm, so we skip it and
	-- avoid the compiled C dependency.
	config = function()
		local dropbar_api = require("dropbar.api")
		vim.keymap.set("n", "<Leader>;", dropbar_api.pick, { desc = "Pick symbols in winbar" })
		vim.keymap.set("n", "[;", dropbar_api.goto_context_start, { desc = "Go to start of current context" })
		vim.keymap.set("n", "];", dropbar_api.select_next_context, { desc = "Select next context" })
	end,
}
