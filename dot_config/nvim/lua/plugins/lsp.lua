return {
  {
    'VonHeikemen/lsp-zero.nvim',
    lazy = true,
    config = false,
    init = function()
      vim.g.lsp_zero_extend_cmp = 0
      vim.g.lsp_zero_extend_lspconfig = 0
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
      local lsp_zero = require('lsp-zero')
      lsp_zero.extend_cmp()
      local cmp = require('cmp')
      local cmp_action = lsp_zero.cmp_action()
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
      local lsp_zero = require('lsp-zero')
      lsp_zero.extend_lspconfig()
      lsp_zero.on_attach(function(client, bufnr)
        lsp_zero.default_keymaps({ buffer = bufnr })
        vim.keymap.set({ 'n', 'x' }, 'gq', function()
          vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
        end, { buffer = bufnr, desc = 'Format Buffer' })
        if client.supports_method('textDocument/inlayHint') then
          vim.lsp.inlay_hint(bufnr, true)
        end
      end)
      require('mason-lspconfig').setup({
        ensure_installed = {
          'bashls', 'dockerls', 'docker_compose_language_service', 'gopls', 'gradle_ls', 'jsonls', 'jdtls',
          'kotlin_language_server', 'texlab', 'lua_ls', 'marksman', 'pyright', 'sqlls', 'taplo', 'yamlls', 'terraformls'
        },
        handlers = {
          lsp_zero.default_setup,
          lua_ls = function()
            local lua_opts = lsp_zero.nvim_lua_ls({ settings = { Lua = { hint = { enable = true } } } })
            require('lspconfig').lua_ls.setup(lua_opts)
          end
        }
      })
      lsp_zero.set_sign_icons({
        error = '✘',
        warn = '▲',
        hint = '⚑',
        info = '»'
      })
      lsp_zero.set_server_config({
        capabilities = {
          textDocument = {
            foldingRange = {
              dynamicRegistration = false,
              lineFoldingOnly = true
            }
          }
        }
      })
    end
  }
}
