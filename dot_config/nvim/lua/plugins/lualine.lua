local M = {
  'nvim-lualine/lualine.nvim',
  dependencies = {
    'nvim-tree/nvim-web-devicons'
  },
  event = "UIEnter",
  opts = {
    options = {
      theme = "material",
      section_separators = '',
      component_separators = '|'
    }
  }
}

vim.o.showmode = false

return M
