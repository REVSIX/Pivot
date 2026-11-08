import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { base, editorHome, nvimPath, pythonPath, executable } from './runtime.mjs'
function version(bin, args) {
  if (!bin) return 'missing'
  const result = spawnSync(bin, args, { encoding: 'utf8', timeout: 10000 })
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : 'unavailable'
}
console.log('Node       ', process.version)
console.log('Git        ', version(executable('git'), ['--version']))
console.log('Neovim     ', version(nvimPath(), ['--version']))
console.log(
  'LazyVim    ',
  existsSync(path.join(editorHome, 'ready')) ? 'profile ready' : 'run npm run setup:editor',
)
try {
  await import('node-pty')
  console.log('Terminal    ready')
} catch {
  console.log('Terminal    node-pty unavailable; see README')
}
console.log(
  'MuJoCo     ',
  version(pythonPath(), ['-I', '-c', 'import mujoco; print(mujoco.__version__)']),
)
console.log(
  'lazygit    ',
  version(
    executable('lazygit') || executable('lazygit', path.join(base, '.hinge/bin/lazygit/lazygit.exe')),
    ['--version'],
  ),
)
console.log(
  'MCAP CLI   ',
  version(pythonPath(), ['-I', '-c', 'import mcap; print(mcap.__version__)']),
)
