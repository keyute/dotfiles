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
      { 'L3MON4D3/LuaSnip' },
      {
        'onsails/lspkind.nvim',
        config = function()
          local lspkind = require('lspkind')
          lspkind.init({
            symbol_map = {
              Copilot = ''
            }
          })
          vim.api.nvim_set_hl(0, "CmpItemKindCopilot", { fg = "#6CC644" })
        end
      },
      {
        'zbirenbaum/copilot-cmp',
        dependencies = {
          {
            'zbirenbaum/copilot.lua',
            cmd = "Copilot",
            opts = {
              suggestion = { enabled = false },
              panel = { enabled = false }
            }
          }
        },
        opts = {}
      }
    },
    config = function()
      require('lsp-zero.cmp').extend()
      local cmp = require('cmp')
      local cmp_action = require('lsp-zero').cmp_action()
      cmp.setup({
        sources = {
          { name = 'copilot' },
          { name = 'nvim_lsp' }
        },
        mapping = {
          ['<Tab>'] = cmp_action.tab_complete(),
          ['<S-Tab>'] = cmp_action.select_prev_or_fallback(),
          ['<CR>'] = cmp.mapping.confirm({
            behaviour = cmp.ConfirmBehavior.Replace,
            select = false
          })
        },
        formatting = {
          fields = { 'abbr', 'kind', 'menu' },
          format = require('lspkind').cmp_format({
            mode = 'symbol_text',
            maxwidth = 50,
            ellipsis_char = '...'
          })
        }
      })
    end
  },
  {
    'neovim/nvim-lspconfig',
    cmd = 'LspInfo',
    event = { 'BufReadPre', 'BufNewFile' },
    dependencies = {
      { 'hrsh7th/cmp-nvim-lsp' },
      { 'williamboman/mason-lspconfig.nvim' },
      { 'williamboman/mason.nvim' },
      {
        "kevinhwang91/nvim-ufo",
        dependencies = {
          "kevinhwang91/promise-async"
        },
        opts = {}
      }
    },
    config = function()
      local lsp = require('lsp-zero')
      lsp.on_attach(function(client, bufnr)
        lsp.default_keymaps({ buffer = bufnr })
        vim.keymap.set({ 'n', 'x' }, 'gq', function()
          vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
        end, { buffer = bufnr, desc = 'Format Buffer' })
        if client.supports_method('textDocument/inlayHint') then
          vim.lsp.inlay_hint(bufnr, true)
        end
      end)
      lsp.ensure_installed({
        'bashls', 'dockerls', 'docker_compose_language_service', 'gopls', 'gradle_ls', 'jsonls', 'jdtls',
        'kotlin_language_server', 'texlab', 'lua_ls', 'marksman', 'pyright', 'sqlls', 'taplo', 'yamlls'
      })
      lsp.set_sign_icons({
        error = '✘',
        warn = '▲',
        hint = '⚑',
        info = '»'
      })
      require('lspconfig').lua_ls.setup(lsp.nvim_lua_ls({ settings = { Lua = { hint = { enable = true } } } }))
      local capabilities = vim.lsp.protocol.make_client_capabilities()
      capabilities.textDocument.foldingRange = {
        dynamicRegistration = false,
        lineFoldingOnly = true
      }
      lsp.set_server_config(capabilities)
      lsp.setup()
    end
  }
}
