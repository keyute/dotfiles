local M = {
  "neoclide/coc.nvim",
  branch = "release"
}

function _G.check_back_space()
  local col = vim.fn.col('.') - 1
  return col == 0 or vim.fn.getline('.'):sub(col, col):match('%s') ~= nil
end

local opts = {silent = true, noremap = true, expr = true, replace_keycodes = false}
local keyset = vim.keymap.set
keyset("i", "<TAB>", 'coc#pum#visible() ? coc#pum#next(1) : v:lua.check_back_space() ? "<TAB>" : coc#refresh()', opts)
keyset("i", "<S-TAB>", [[coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"]], opts)

vim.g.coc_global_extensions = {
  "coc-json", "coc-yaml", "coc-toml", "coc-sumneko-lua", "coc-sh", "coc-markdownlint",
  "coc-webview", "coc-pyright", "coc-vimtex"
}

return M
