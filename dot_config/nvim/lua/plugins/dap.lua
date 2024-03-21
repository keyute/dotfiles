return {
  "jay-babu/mason-nvim-dap.nvim",
  event = { 'BufReadPre', 'BufNewFile' },
  dependencies = {
    {
      "rcarriga/nvim-dap-ui",
      dependencies = {
        "mfussenegger/nvim-dap",
        "nvim-neotest/nvim-nio"
      },
    },
    "williamboman/mason.nvim"
  },
  opts = {
    ensure_installed = { "python", "cppdbg" },
    automatic_installation = true
  }
}
