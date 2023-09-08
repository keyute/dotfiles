return {
  "f-person/auto-dark-mode.nvim",
  event = "VeryLazy",
  opts = {
    update_interval = 1000,
    set_dark_mode = function()
      require('material.functions').change_style("darker")
    end,
    set_light_mode = function()
      require('material.functions').change_style("lighter")
    end
  }
}
