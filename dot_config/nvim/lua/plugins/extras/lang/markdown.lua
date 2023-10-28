return {
  "saimo/peek.nvim",
  build = "deno task --quiet build",
  opts = {
    app = 'browser',
    theme = vim.g.material_style == 'lighter' and 'light' or 'dark'
  },
  keys = {
    {
      "<leader>p",
      function()
        require('peek').open()
      end,
      desc = "Preview Markdown"
    }
  }
}
