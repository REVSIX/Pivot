import { spawn } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { base, pythonPath } from '../scripts/runtime.mjs'
import { Fault, inside } from './workspace.ts'
import type { Capture } from '../client/src/model.ts'

export async function runModel(
  root: string,
  folder: unknown,
  file: unknown,
  signal: AbortSignal,
): Promise<Capture> {
  const dir = await inside(root, folder, 'directory')
  const model = await inside(dir, file, 'file')
  if (path.extname(model).toLowerCase() !== '.xml' || (await stat(model)).size > 65536)
    throw new Fault('Select an MJCF .xml file under 64 KiB.')
  const python = pythonPath()
  if (!python) throw new Fault('Install the simulation environment from the README, then retry.', 503)
  const input = await readFile(model)
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-I', path.join(base, 'simulator', 'run.py')], {
      cwd: path.join(base, 'simulator'),
      windowsHide: true,
      stdio: 'pipe',
      signal,
      timeout: 20000,
      killSignal: 'SIGKILL',
    })
    const chunks: Buffer[] = []
    let size = 0,
      error = ''
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 3 * 1024 * 1024) child.kill('SIGKILL')
      else chunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (error.length < 4096) error += chunk.toString()
    })
    child.on('error', () => reject(new Fault('Simulation process unavailable or cancelled.', 503)))
    child.stdin.on('error', () => {})
    child.on('close', (code) => {
      if (code !== 0)
        return reject(
          new Fault(error.trim() || 'Simulation stopped or exceeded a resource limit.', 422),
        )
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()) as Capture)
      } catch {
        reject(new Fault('Invalid capture from MuJoCo.', 500))
      }
    })
    child.stdin.end(input)
  })
}
