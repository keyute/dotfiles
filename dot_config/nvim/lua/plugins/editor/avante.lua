return {
	"yetone/avante.nvim",
	build = "make",
	dependencies = {
		"nvim-lua/plenary.nvim",
		"MunifTanjim/nui.nvim",
		"nvim-telescope/telescope.nvim",
		"nvim-tree/nvim-web-devicons",
		"MeanderingProgrammer/render-markdown.nvim",
	},
	keys = {
		{ "<leader>at", "<cmd>AvanteToggle<cr>", desc = "[A]vante [T]oggle" },
	},
	opts = {
		provider = "claude",
		providers = {
			claude = {
				endpoint = "https://api.kubecity.ai",
				model = "anthropic/claude-sonnet-4",
				api_key_name = "cmd:op read op://Personal/LiteLLM/api key",
				extra_request_body = {
					reasoning_effort = "high",
				},
			},
		},
	},
}
