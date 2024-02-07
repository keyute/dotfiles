return {
    "jay-babu/mason-nvim-dap.nvim",
    event = { 'BufReadPre', 'BufNewFile' },
    dependencies = {
        {
            "rcarriga/nvim-dap-ui",
            dependencies = {
                "mfussenegger/nvim-dap"
            }
        },
        "williamboman/mason.nvim"
    },
    opts = {
        ensure_installed = { "python" },
        automatic_installation = true
    }
}
