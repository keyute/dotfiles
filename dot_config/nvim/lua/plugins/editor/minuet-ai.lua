local is_macos = vim.uv.os_uname().sysname == "Darwin"

-- macOS runs oMLX (MLX) serving JetBrains Mellum-4b; Linux runs Ollama serving Qwen.
-- Both listen on 11434, so only the model (and macOS's FIM template) differ.
local fim = {
	api_key = "TERM",
	name = "Ollama",
	end_point = "http://localhost:11434/v1/completions",
	model = is_macos and "Mellum-4b-base-4bit" or "qwen2.5-coder:1.5b-base-q4_0",
	optional = {
		max_tokens = 128,
		top_p = 0.9,
	},
}

if is_macos then
	-- oMLX passes the prompt through as-is (no server-side suffix handling), and
	-- Mellum uses SPM-order FIM tokens (no pipes), so embed them here and disable suffix.
	fim.template = {
		prompt = function(context_before_cursor, context_after_cursor, _)
			return "<fim_suffix>" .. context_after_cursor .. "<fim_prefix>" .. context_before_cursor .. "<fim_middle>"
		end,
		suffix = false,
	}
end

return {
	"milanglacier/minuet-ai.nvim",
	dependencies = {
		"nvim-lua/plenary.nvim",
		"saghen/blink.cmp",
	},
	main = "minuet",
	event = "InsertEnter",
	opts = {
		provider = "openai_fim_compatible",
		n_completions = 1,
		context_window = 8000,
		provider_options = {
			openai_fim_compatible = fim,
		},
	},
}
