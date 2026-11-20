import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync, writeFileSync, copyFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { base, editorHome, editorEnv, profile, nvimPath, executable } from './runtime.mjs'

const nvim = nvimPath(),
  git = executable('git')
if (!nvim || !git)
  throw new Error(
    'Install Neovim and Git, or set PIVOT_NVIM to an absolute executable path. See README.',
  )
function run(bin, args, cwd) {
  const result = spawnSync(bin, args, {
    cwd,
    env: { ...editorEnv(), PIVOT_INSTALL: '1' },
    stdio: 'inherit',
    shell: false,
  })
  if (result.status !== 0) throw new Error('Setup failed. Check the output above, then retry.')
}
const plugins = path.join(editorHome, 'plugins')
mkdirSync(plugins, { recursive: true })
const ready = path.join(editorHome, 'ready')
rmSync(ready, { force: true })
for (const [name, url, revision] of [
  ['lazy.nvim', 'https://github.com/folke/lazy.nvim.git', '85c7ff3711b730b4030d03144f6db6375044ae82'],
  ['LazyVim', 'https://github.com/LazyVim/LazyVim.git', '999700997f72227187d49d8b92667183dc7fc809'],
]) {
  const dir = path.join(plugins, name)
  mkdirSync(dir, { recursive: true })
  if (!existsSync(path.join(dir, '.git'))) run(git, ['init', '--quiet'], dir)
  run(git, ['fetch', '--quiet', '--depth=1', url, revision], dir)
  run(git, ['checkout', '--quiet', '-B', name === 'lazy.nvim' ? 'stable' : 'main', revision], dir)
  if (spawnSync(git, ['remote', 'get-url', 'origin'], { cwd: dir, stdio: 'ignore' }).status !== 0)
    run(git, ['remote', 'add', 'origin', url], dir)
}
const lock = path.join(base, 'editor/lazy-lock.json')
if (existsSync(lock)) copyFileSync(lock, path.join(editorHome, 'lazy-lock.json'))
run(
  nvim,
  [
    '--headless',
    '-u',
    profile,
    '+lua require("lazy").install({wait=true, show=false, lockfile=true})',
    '+qa',
  ],
  base,
)
if (existsSync(lock)) {
  const pinned = JSON.parse(readFileSync(lock, 'utf8'))
  const mismatch = Object.entries(pinned).some(([name, info]) => {
    const result = spawnSync(git, ['rev-parse', 'HEAD'], {
      cwd: path.join(plugins, name),
      encoding: 'utf8',
    })
    return result.stdout?.trim() !== info.commit
  })
  if (mismatch) {
    copyFileSync(lock, path.join(editorHome, 'lazy-lock.json'))
    run(nvim, ['--headless', '-u', profile, '+Lazy! restore', '+qa'], base)
  }
  for (const [name, info] of Object.entries(pinned)) {
    const result = spawnSync(git, ['rev-parse', 'HEAD'], {
      cwd: path.join(plugins, name),
      encoding: 'utf8',
    })
    if (result.stdout?.trim() !== info.commit)
      throw new Error('Plugin checkout is incomplete: ' + name)
  }
}
const installed = JSON.parse(readFileSync(path.join(editorHome, 'lazy-lock.json'), 'utf8'))
if (!installed['LazyVim'] || !installed['snacks.nvim'])
  throw new Error('Incomplete LazyVim plugin install.')
run(
  nvim,
  [
    '--headless',
    '-u',
    profile,
    '+lua if not pcall(require,"lazyvim.config") or vim.fn.exists(":PivotFiles") ~= 2 then vim.cmd("cquit 1") end',
    '+qa',
  ],
  base,
)
writeFileSync(ready, 'ready\n')
console.log('Isolated LazyVim profile ready.')
