return {
  "saimo/peek.nvim",
  build = "deno task --quiet build",
  opts = {
    app = 'browser'
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
