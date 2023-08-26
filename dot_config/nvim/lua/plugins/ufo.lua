return {
  "kevinhwang91/nvim-ufo",
  dependencies = {
    "kevinhwang91/promise-async"
  },
  event = "VeryLazy",
  opts = {
    provider_selector = function()
      return {'treesitter', 'indent'}
    end
  }
}
