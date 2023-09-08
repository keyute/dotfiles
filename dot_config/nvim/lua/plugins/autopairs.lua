return {
  "windwp/nvim-autopairs",
  event = "InsertEnter",
  dependencies = {
    'hrsh7th/nvim-cmp'
  },
  config = function()
    local cmp_autopairs = require('nvim-autopairs.completion.cmp')
    local cmp = require('cmp')
    cmp.event:on(
      'confirm_done',
      cmp_autopairs.on_confirm_done()
    )
    require('nvim-autopairs').setup({
      check_ts = true,
      enable_check_bracket_line = true,
      ignored_next_char = '[%w%.]'
    })
  end
}
