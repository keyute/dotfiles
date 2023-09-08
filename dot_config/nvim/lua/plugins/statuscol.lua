local M = {
  "luukvbaal/statuscol.nvim",
  dependencies = {
    {
      "lewis6991/gitsigns.nvim",
      opts = {}
    },
    {
      "kevinhwang91/nvim-ufo",
      dependencies = {
        "kevinhwang91/promise-async"
      },
      opts = {}
    }
  },
  event = "UIEnter",
  config = function()
    local builtin = require("statuscol.builtin")
    require("statuscol").setup({
      relculright = true,
      segments = {
        {text = {builtin.foldfunc}, click = "v:lua.ScFa"},
        {text = {" "}},
        {text = {"%s"}, click = "v:lua.ScSa"},
        {text = {builtin.lnumfunc, " "}, click = "v:lua.ScLa"}
      }
    })
  end
}

vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]

vim.o.foldcolumn = '1'
vim.o.foldlevel = 99
vim.o.foldlevelstart = 99
vim.wo.numberwidth = 1

return M
