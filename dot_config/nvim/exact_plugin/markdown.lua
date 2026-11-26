vim.pack.add({ "https://github.com/MeanderingProgrammer/render-markdown.nvim" })

---@module 'render-markdown'
---@type render.md.UserConfig
local opts = {
	file_types = { "markdown", "mdx" },
}

require("render-markdown").setup(opts)
