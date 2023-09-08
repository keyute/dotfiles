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
      { 'onsails/lspkind.nvim' }
    },
    config = function()
      require('lsp-zero.cmp').extend()
      local cmp = require('cmp')
      local cmp_action = require('lsp-zero').cmp_action()
      cmp.setup({
        mapping = {
          ['<Tab>'] = cmp_action.tab_complete(),
          ['<S-Tab>'] = cmp_action.select_prev_or_fallback()
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
      { 'williamboman/mason.nvim' }
    },
    config = function()
      local lsp = require('lsp-zero')
      lsp.on_attach(function(_, bufnr)
        lsp.default_keymaps({ buffer = bufnr })
        vim.keymap.set({ 'n', 'x' }, 'gq', function()
          vim.lsp.buf.format({ async = false, timeout_ms = 10000 })
        end, { buffer = bufnr, desc = 'Format Buffer' })
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
      require('lspconfig').lua_ls.setup(lsp.nvim_lua_ls())
      lsp.setup()
    end
  }
}
