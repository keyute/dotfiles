return {
  "iamcco/markdown-preview.nvim",
  ft = "markdown",
  build = function()
    vim.fn["mkdp#util#install"]()
  end,
  config = function()
    vim.g.mkdp_preview_options = {
      disable_filename = 1
    }
    vim.keymap.set("n", "<leader>p", ":MarkdownPreview<CR>", { silent = true, noremap = true })
  end
}
