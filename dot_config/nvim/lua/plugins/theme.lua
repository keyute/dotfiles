return {
  {
    'marko-cerovac/material.nvim',
    priority = 1000,
    config = function()
      vim.o.termguicolors = true
      local handle = io.popen("defaults read -g AppleInterfaceStyle")
      if handle then
        local result = handle:read("*a")
        handle:close()
        if result:match("^Dark") then
          vim.g.material_style = "darker"
        else
          vim.g.material_style = "lighter"
        end
      end
      vim.cmd.colorscheme("material")
      require('material').setup({
        plugins = {
          "indent-blankline", "nvim-tree", "nvim-web-devicons", "gitsigns", "telescope", "which-key"
        },
        contrast = {
          sidebars = true,
          floating_windows = true,
          cursor_line = true
        }
      })
    end
  },
  {
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
}
