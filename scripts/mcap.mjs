import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { base, pythonPath } from './runtime.mjs'
const python = pythonPath()
if (!python)
  throw new Error('Create .venv and install simulator/mcap-requirements.txt first. See README.')
const args = process.argv.slice(2)
const result = spawnSync(python, ['-I', path.join(base, 'scripts', 'csv_to_mcap.py'), ...args], {
  stdio: 'inherit',
  cwd: process.env.INIT_CWD || process.cwd(),
})
process.exitCode = result.status ?? 1
