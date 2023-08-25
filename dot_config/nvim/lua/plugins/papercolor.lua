local M = {
  'NLKNguyen/papercolor-theme',
  config = function()
    vim.cmd.colorscheme('PaperColor')
  end,
  priority = 1000
}

vim.opt.termguicolors = true

return M
