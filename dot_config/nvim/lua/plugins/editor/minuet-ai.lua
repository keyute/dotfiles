local is_macos = vim.uv.os_uname().sysname == "Darwin"

-- macOS runs oMLX (MLX) serving JetBrains Mellum-4b; Linux runs Ollama serving Qwen.
-- Both listen on 11434, so only the model (and macOS's FIM template) differ.
local fim = {
	api_key = "TERM",
	name = "Ollama",
	end_point = "http://localhost:11434/v1/completions",
	model = is_macos and "Mellum-4b-base-4bit" or "qwen2.5-coder:1.5b-base-q4_0",
	optional = {
		-- Linux (Arc iGPU, ~28 tok/s) must fit generation inside minuet/blink's 3s
		-- budget; macOS (M4 Max) affords longer completions.
		max_tokens = is_macos and 128 or 48,
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
		-- Linux prefill (~900-1000 tok/s on the Arc iGPU) must fit the 3s budget
		-- alongside generation; measured: 3000 chars → cold ~1.5s, warm ~1.5s.
		context_window = is_macos and 8000 or 3000,
		provider_options = {
			openai_fim_compatible = fim,
		},
	},
}
