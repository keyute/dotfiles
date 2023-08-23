return {
  "iamcco/markdown-preview.nvim",
  ft = "markdown",
  cmd = { "MarkdownPreview", "MarkdownPreviewStop" },
  build = function()
    vim.fn["mkdp#util#install"]()
  end,
  config = function()
    vim.keymap.set("n", "<leader>p", ":MarkdownPreview<CR>", {silent = true, noremap = true})
  end
}
