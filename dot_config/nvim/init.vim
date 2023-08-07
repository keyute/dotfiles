" Plugin System
call plug#begin()
Plug 'itchyny/lightline.vim'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jiangmiao/auto-pairs'
Plug 'NLKNguyen/papercolor-theme'
Plug 'f-person/auto-dark-mode.nvim'
call plug#end()

" General Vim Config
set number
set wrap!

" Theme
colorscheme PaperColor
lua << EOF
local auto_dark_mode = require('auto-dark-mode')
auto_dark_mode.setup({
  update_interval = 1000,
  set_dark_mode = function()
    vim.api.nvim_set_option('background', 'dark')
  end,
  set_light_mode = function()
    vim.api.nvim_set_option('background', 'light')
  end,
})
EOF

" Lightline Config
set noshowmode
let g:lightline = {'colorscheme': 'PaperColor'}

" Indentation
set expandtab
set tabstop=2
set shiftwidth=2
set softtabstop=2

" use <tab> to trigger completion and navigate to the next complete item
inoremap <silent><expr> <TAB>
      \ coc#pum#visible() ? coc#pum#next(1) :
      \ CheckBackspace() ? "\<Tab>" :
      \ coc#refresh()
inoremap <expr><S-TAB> coc#pum#visible() ? coc#pum#prev(1) : "\<C-h>"

function! CheckBackspace() abort
  let col = col('.') - 1
  return !col || getline('.')[col - 1]  =~# '\s'
endfunction

" coc related settings
let g:coc_global_extensions = ['coc-json', 'coc-yaml', 'coc-vimlsp', 'coc-toml', 'coc-lua']

