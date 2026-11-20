import { parseArgs } from 'node:util'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { base } from '../scripts/runtime.mjs'
import { createWorkbench } from './app.ts'

const { values } = parseArgs({
  options: {
    root: { type: 'string' },
    port: { type: 'string', default: '4317' },
    dev: { type: 'boolean' },
  },
})
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('Choose a port between 1 and 65535.')
if (!values.dev && !existsSync(path.join(base, 'dist/index.html')))
  throw new Error('Run npm run build first.')
const workbench = await createWorkbench({
  root: values.root || path.join(base, 'examples'),
  dev: values.dev,
})
workbench.server.on('error', (err) => {
  console.error(err.message)
  process.exit(1)
})
workbench.server.listen(port, '127.0.0.1', () =>
  console.log('Pivot is ready at http://127.0.0.1:' + port),
)
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => void workbench.close())
