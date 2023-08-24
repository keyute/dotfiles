return {
  "RRethy/vim-illuminate",
  event = {"CursorMoved", "CursorMovedI"},
  config = function()
    require('illuminate').configure({
      filetypes_denylist = {
        "NvimTree"
      },
      providers = {'treesitter'}
    })
  end
}
