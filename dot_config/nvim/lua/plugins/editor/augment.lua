return {
	"augmentcode/augment.vim",
	cmd = "Augment",
	keys = {
		{ "<leader>ac", "<cmd>Augment chat-toggle<cr>", desc = "[A]ugment [C]hat Toggle" },
	},
	init = function()
		vim.g.augment_disable_completions = true
	end,
}
