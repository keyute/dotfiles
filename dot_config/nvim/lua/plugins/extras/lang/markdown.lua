return {
  "saimo/peek.nvim",
  build = "deno task --quiet build",
  config = function()
    require('peek').setup({
      app = 'browser',
      theme = vim.g.material_style == 'lighter' and 'light' or 'dark'
    })
  end,
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
