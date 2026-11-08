import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { base, pythonPath } from './runtime.mjs'
const python = pythonPath()
const suite = process.argv[2]
if (!['sim', 'mcap'].includes(suite)) throw new Error('Choose the sim or mcap suite.')
if (!python) throw new Error('Install the Python dependencies in .venv first. See README.')
const r = spawnSync(
  python,
  [
    '-I',
    '-m',
    'unittest',
    'discover',
    '-s',
    path.join(base, 'tests'),
    '-p',
    'test_' + suite + '.py',
    '-v',
  ],
  { stdio: 'inherit' },
)
process.exitCode = r.status ?? 1
