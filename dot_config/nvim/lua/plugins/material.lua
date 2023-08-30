local M = {
  'marko-cerovac/material.nvim',
  priority = 1000,
  config = function()
    vim.cmd.colorscheme("material")
    require('material').setup({
      plugins = {
        "indent-blankline", "nvim-tree", "nvim-web-devicons", "gitsigns", "telescope", "which-key"
      },
      contrast = {
        sidebars = true,
        floating_windows = true,
        cursor_line = true
      }
    })
  end
}

vim.o.termguicolors = true

if vim.o.background == "light" then
  vim.g.material_style = "lighter"
else
  vim.g.material_style = "darker"
end

return M
