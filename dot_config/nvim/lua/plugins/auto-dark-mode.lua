return {
  "f-person/auto-dark-mode.nvim",
  event = "UIEnter",
  opts = {
    update_interval = 1000,
    set_dark_mode = function()
      vim.o.background = "dark"
      require('material.functions').change_style("darker")
    end,
    set_light_mode = function()
      vim.o.background = "light"
      require('material.functions').change_style("lighter")
    end
  }
}
