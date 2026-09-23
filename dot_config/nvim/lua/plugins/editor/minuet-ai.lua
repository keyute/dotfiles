-- oMLX (MLX) serves JetBrains Mellum2 (12B MoE, 2.5B active) on localhost:11434.
local fim = {
	api_key = "TERM",
	name = "Ollama",
	end_point = "http://localhost:11434/v1/completions",
	model = "Mellum2-12B-A2.5B-Base-4bit",
	optional = {
		max_tokens = 128,
		top_p = 0.9,
	},
}

-- oMLX passes the prompt through as-is (no server-side suffix handling), and
-- Mellum2 expects a <filename> tag followed by SPM-order FIM tokens (no pipes),
-- so embed them here and disable suffix.
fim.template = {
	prompt = function(context_before_cursor, context_after_cursor, _)
		return "<filename>"
			.. vim.fn.expand("%:.")
			.. "\n<fim_suffix>"
			.. context_after_cursor
			.. "<fim_prefix>"
			.. context_before_cursor
			.. "<fim_middle>"
	end,
	suffix = false,
}

return {
	"milanglacier/minuet-ai.nvim",
	main = "minuet",
	event = { "BufReadPre", "BufNewFile" },
	opts = {
		provider = "openai_fim_compatible",
		n_completions = 1,
		context_window = 8000,
		request_timeout = 3,
		provider_options = {
			openai_fim_compatible = fim,
		},
		virtualtext = {
			auto_trigger_ft = { "*" },
			-- Show inline suggestions even while blink's menu is visible; with the
			-- super-tab preset that menu is up on nearly every keystroke, and minuet
			-- otherwise suppresses ghost text whenever a completion menu shows.
			show_on_completion_menu = true,
			keymap = {
				accept = "<A-A>",
				accept_line = "<A-a>",
				accept_n_lines = "<A-z>",
				prev = "<A-[>",
				next = "<A-]>",
				dismiss = "<A-e>",
			},
		},
	},
}
