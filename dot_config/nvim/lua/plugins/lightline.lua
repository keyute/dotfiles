return {
  "itchyny/lightline.vim",
  config = function()
    vim.o.showmode = false
    vim.g.lightline = {
      colorscheme = 'PaperColor',
      enable = {
        tabline = 0
      }
    }
  end
}
