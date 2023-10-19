return {
  'akinsho/toggleterm.nvim',
  opts = {},
  keys = {
    { '<leader>tt', '<cmd>ToggleTerm direction=tab<cr>',        desc = "Terminal in New Tab" },
    { '<leader>tv', '<cmd>ToggleTerm direction=vertical<cr>',   desc = "Terminal in Vertical Tab" },
    { '<leader>th', '<cmd>ToggleTerm direction=horizontal<cr>', desc = "Terminal in Horizontal Tab" }
  }
}
