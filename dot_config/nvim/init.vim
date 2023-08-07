" Plugin System
call plug#begin()
Plug 'itchyny/lightline.vim'
Plug 'neoclide/coc.nvim', {'branch': 'release'}
Plug 'jiangmiao/auto-pairs'
Plug 'NLKNguyen/papercolor-theme'
Plug 'vimpostor/vim-lumen'
call plug#end()

" General Vim Config
set number
set wrap!
colorscheme PaperColor

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

" coc related settings
let g:coc_global_extensions = ['coc-json', 'coc-yaml', 'coc-vimlsp', 'coc-toml']

