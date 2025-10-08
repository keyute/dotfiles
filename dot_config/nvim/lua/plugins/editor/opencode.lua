return {
	"NickvanDyke/opencode.nvim",
	dependencies = {
		{ "folke/snacks.nvim", opts = { input = {}, picker = {} } },
	},
	keys = {
		{
			"<leader>oa",
			function()
				require("opencode").ask("", { submit = true })
			end,
			desc = "[O]pencode [A]sk",
			mode = { "n", "x" },
		},
		{
			"<leader>o+",
			function()
				require("opencode").prompt("@this")
			end,
			desc = "[O]pencode Add [+]",
			mode = { "n", "x" },
		},
		{
			"<leader>os",
			function()
				require("opencode").select()
			end,
			desc = "[O]pencode [S]elect",
			mode = { "n", "x" },
		},
		{
			"<leader>ot",
			function()
				require("opencode").toggle()
			end,
			desc = "[O]pencode [T]oggle",
		},
		{
			"<leader>on",
			function()
				require("opencode").command("session_new")
			end,
			desc = "[O]pencode [N]ew",
		},
		{
			"<leader>oi",
			function()
				require("opencode").command("session_interrupt")
			end,
			desc = "[O]pencode [I]nterrupt",
		},
	},
}
