return {
  {
    'VonHeikemen/lsp-zero.nvim',
    lazy = true,
    config = function()
      require('lsp-zero.settings').preset({})
    end
  },
  {
    'hrsh7th/nvim-cmp',
    event = 'InsertEnter',
    dependencies = {
      {'L3MON4D3/LuaSnip'},
    },
    config = function()
      require('lsp-zero.cmp').extend()
      local cmp = require('cmp')
      cmp.setup({
        completion = {completeopt = 'menu,menuone,noinsert'},
        mapping = {
          ["<Tab>"] = cmp.mapping(function(fallback)
            if cmp.visible() then
              local entry = cmp.get_selected_entry()
              if not entry then
                cmp.select_next_item({behaviour = cmp.SelectBehavior.Select})
                entry = cmp.get_selected_entry()
              end
              cmp.confirm()
            else
              fallback()
            end
          end, {"i", "s", "c"})
        }
      })
    end
  },
  {
    'neovim/nvim-lspconfig',
    cmd = 'LspInfo',
    event = {'BufReadPre', 'BufNewFile'},
    dependencies = {
      {'hrsh7th/cmp-nvim-lsp'},
      {'williamboman/mason-lspconfig.nvim'},
      {'williamboman/mason.nvim'},
    },
    config = function()
      local lsp = require('lsp-zero')
      lsp.on_attach(function(_, bufnr)
        lsp.default_keymaps({buffer = bufnr})
      end)
      lsp.ensure_installed({
        "bashls", "dockerls", "docker_compose_language_service", "gopls", "gradle_ls", "jsonls", "jdtls",
        "kotlin_language_server", "texlab", "lua_ls", "marksman", "pyright", "sqlls", "taplo", "yamlls"
      })
      require('lspconfig').lua_ls.setup(lsp.nvim_lua_ls())
      lsp.setup()
    end
  }
}
