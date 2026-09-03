return {
	"nvim-mini/mini.icons",
	lazy = true,
	opts = {},
	init = function()
		-- Anything still requiring nvim-web-devicons (lualine) gets mini.icons'
		-- compatibility shim instead; the real plugin is no longer installed.
		package.preload["nvim-web-devicons"] = function()
			require("mini.icons").mock_nvim_web_devicons()
			return package.loaded["nvim-web-devicons"]
		end
	end,
}
