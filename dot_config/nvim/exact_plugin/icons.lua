vim.pack.add({ "https://github.com/nvim-mini/mini.icons" })

require("mini.icons").setup()
-- Anything still requiring nvim-web-devicons (lualine) gets mini.icons'
-- compatibility shim instead; the real plugin is not installed.
MiniIcons.mock_nvim_web_devicons()
