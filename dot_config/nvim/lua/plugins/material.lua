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

local handle = io.popen("defaults read -g AppleInterfaceStyle")
if handle then
  local result = handle:read("*a")
  handle:close()

  if result:match("^Dark") then
    vim.o.background = "dark"
    vim.g.material_style = "darker"
  else
    vim.o.background = "light"
    vim.g.material_style = "lighter"
  end
end

return M
