return {
  "kevinhwang91/nvim-ufo",
  dependencies = {
    "kevinhwang91/promise-async",
    {
      "luukvbaal/statuscol.nvim",
      config = function()
        local builtin = require("statuscol.builtin")
        require("statuscol").setup({
          relculright = true,
          segments = {
            {text = {builtin.foldfunc}, click = "v:lua.ScFa"},
            {text = {"%s"}, click = "v:lua.ScSa"},
            {text = {builtin.lnumfunc, " "}, click = "v:lua.ScLa"}
          }
        })
        vim.o.fillchars = [[eob: ,fold: ,foldopen:,foldsep: ,foldclose:]]
      end
    }
  },
  opts = {
    provider_selector = function()
      return {'treesitter', 'indent'}
    end
  },
  init = function()
    vim.o.foldcolumn = '1'
    vim.o.foldlevel = 99
    vim.o.foldlevelstart = 99
  end
}
