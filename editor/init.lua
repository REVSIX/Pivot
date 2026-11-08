local root = assert(vim.env.HINGE_EDITOR)
vim.g.mapleader = " "
vim.g.maplocalleader = "\\"
vim.opt.exrc = false
vim.opt.rtp:prepend(root .. "/plugins/lazy.nvim")
require("lazy").setup({
  root = root .. "/plugins",
  lockfile = root .. "/lazy-lock.json",
  local_spec = false,
  install = { missing = vim.env.HINGE_INSTALL == "1" },
  checker = { enabled = false },
  change_detection = { enabled = false },
  spec = {
    { "LazyVim/LazyVim", import = "lazyvim.plugins", commit = "999700997f72227187d49d8b92667183dc7fc809",
      opts = { colorscheme = "tokyonight-night" } },
    { "folke/snacks.nvim", opts = { animate = { enabled = false }, dashboard = { enabled = false } } },
    { "MagicDuck/grug-far.nvim", enabled = false },
    { "nvim-treesitter/nvim-treesitter", build = false,
      opts = function(_, opts) opts.ensure_installed = {} end },
    { "mason-org/mason.nvim", enabled = false },
    { "mason-org/mason-lspconfig.nvim", enabled = false },
    { "neovim/nvim-lspconfig", opts = function(_, opts) opts.servers = {} end },
  },
})
vim.api.nvim_create_user_command("HingeGit", function() Snacks.picker.git_status() end, {})
vim.api.nvim_create_user_command("HingeFiles", function() Snacks.picker.files() end, {})

