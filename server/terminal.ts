// The helper owns the native PTY and its OS handles for exactly one editor session.
import { profile } from '../scripts/runtime.mjs'
const [nvim, cwd, target] = process.argv.slice(2)
const nativePackage = 'node-pty'
type Input = { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }
try {
  const { spawn } = await import(nativePackage)
  const term = spawn(nvim, ['-u', profile, '--', target], {
    cwd,
    env: process.env,
    cols: 96,
    rows: 30,
    name: 'xterm-256color',
    useConptyDll: process.platform === 'win32',
  })
  let pending = 0
  term.onData((data: string) => {
    if (!process.connected) return
    pending += Buffer.byteLength(data)
    if (pending > 2_097_152) {
      term.kill()
      return
    }
    process.send!({ type: 'data', data }, () => {
      pending -= Buffer.byteLength(data)
    })
  })
  term.onExit(() => process.exit(0))
  process.on('message', (msg: Input) => {
    if (msg.type === 'input') term.write(msg.data)
    else term.resize(msg.cols, msg.rows)
  })
  process.once('disconnect', () => {
    term.kill()
    setTimeout(() => process.exit(0), 1500).unref()
  })
  if (!process.connected) {
    term.kill()
    process.exit(0)
  }
  process.send!({ type: 'ready' })
} catch {
  if (process.connected)
    process.send!(
      {
        type: 'error',
        data: 'Terminal unavailable. Check Neovim and the optional node-pty dependency.',
      },
      () => process.exit(1),
    )
  else process.exit(1)
}
