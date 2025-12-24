return {
	"milanglacier/minuet-ai.nvim",
	deps = {
		"nvim-lua/plenary.nvim",
		"Saghen/blink.cmp",
	},
	main = "minuet",
	event = "InsertEnter",
	opts = {
		provider = "openai_fim_compatible",
		n_completions = 1,
		context_window = 8000,
		provider_options = {
			openai_fim_compatible = {
				api_key = "TERM",
				name = "Ollama",
				end_point = "http://localhost:11434/v1/completions",
				model = "qwen2.5-coder:3b-base-q8_0",
				optional = {
					max_tokens = 56,
					top_p = 0.9,
				},
			},
		},
	},
}
