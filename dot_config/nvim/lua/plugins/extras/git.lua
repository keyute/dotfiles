return {
    "NeogitOrg/neogit",
    dependencies = {
        "nvim-lua/plenary.nvim",
        "nvim-telescope/telescope.nvim",
        "sindrets/diffview.nvim",
        "ibhagwan/fzf-lua"
    },
    opts = {},
    keys = {
        {
            "<leader>gg",
            function()
                require('neogit').open({ kind = "split" })
            end,
            desc = "Neogit"
        }
    }
}
