local root = assert(vim.env.PIVOT_EDITOR)
local colorscheme_file = vim.fn.stdpath("state") .. "/pivot-colorscheme"
local saved = vim.fn.filereadable(colorscheme_file) == 1 and vim.fn.readfile(colorscheme_file, "", 1)[1]
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
vim.opt.exrc = false
vim.opt.rtp:prepend(root .. "/plugins/lazy.nvim")
require("lazy").setup({
  root = root .. "/plugins",
  lockfile = root .. "/lazy-lock.json",
  local_spec = false,
  install = { missing = vim.env.PIVOT_INSTALL == "1" },
  checker = { enabled = false },
  change_detection = { enabled = false },
  spec = {
    { "LazyVim/LazyVim", import = "lazyvim.plugins", commit = "999700997f72227187d49d8b92667183dc7fc809",
      opts = { colorscheme = function()
        if not saved or not pcall(vim.cmd.colorscheme, saved) then vim.cmd.colorscheme("tokyonight-night") end
      end } },
    { "folke/snacks.nvim", opts = { animate = { enabled = false }, dashboard = { enabled = false } } },
    { "MagicDuck/grug-far.nvim", enabled = false },
    { "nvim-treesitter/nvim-treesitter", build = false,
      opts = function(_, opts) opts.ensure_installed = {} end },
    { "mason-org/mason.nvim", enabled = false },
    { "mason-org/mason-lspconfig.nvim", enabled = false },
    { "neovim/nvim-lspconfig", opts = function(_, opts)
      opts.servers.lua_ls.enabled = vim.fn.executable("lua-language-server") == 1
      opts.servers.clangd = { mason = false, enabled = vim.fn.executable("clangd") == 1 }
      opts.servers.pyright = { mason = false, enabled = vim.fn.executable("pyright-langserver") == 1 }
    end },
    { "akinsho/bufferline.nvim", opts = {
      options = { show_buffer_icons = false, close_icon = "x", buffer_close_icon = "x", modified_icon = "*" },
    } },
    { "nvim-lualine/lualine.nvim", opts = function(_, opts)
      opts.options.icons_enabled = false
      opts.options.component_separators = { left = "|", right = "|" }
      opts.options.section_separators = { left = "", right = "" }
      opts.sections.lualine_c = { { "filename", path = 1 }, "diagnostics" }
      opts.sections.lualine_z = { function() return os.date("%R") end }
    end },
  },
})
vim.api.nvim_create_autocmd("ColorScheme", {
  callback = function(event)
    vim.fn.mkdir(vim.fn.fnamemodify(colorscheme_file, ":h"), "p")
    pcall(vim.fn.writefile, { event.match }, colorscheme_file)
  end,
})
vim.api.nvim_create_user_command("PivotGit", function() Snacks.picker.git_status() end, {})
vim.api.nvim_create_user_command("PivotFiles", function() Snacks.picker.files() end, {})

