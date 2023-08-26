local M = {
  "akinsho/bufferline.nvim",
  dependencies = {
    "nvim-tree/nvim-web-devicons"
  },
  event = "UIEnter",
  opts = {
    options = {
      offsets = {
        {
          filetype = "NvimTree",
          text = "File Explorer",
          text_align = "center",
        }
      },
      close_icon = '',
      modified_icon = '●',
      buffer_close_icon = '󰅖',
      left_trunc_marker = '',
      right_trunc_marker = '',
      hover = {
        enabled = true,
        delay = 0,
        reveal = {'close'}
      },
      diagnostics = "coc",
      diagnostics_indicator = function(_, _, diagnostics_dict, _)
        local s = " "
        for e, n in pairs(diagnostics_dict) do
          local sym = e == "error" and " "
            or (e == "warning" and " " or "" )
          s = s .. n .. sym
        end
        return s
      end
    }
  }
}

vim.o.mouse = 'a'
vim.o.mousemoveevent = true

return M
