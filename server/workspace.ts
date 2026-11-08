import path from 'node:path'
import { realpath, stat, opendir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { base, executable } from '../scripts/runtime.mjs'
import type { Project } from '../client/src/model.ts'
const exec = promisify(execFile)
export const example = path.join(base, 'examples', 'pendulum')
export const ignored = new Set(['node_modules', 'dist', '__pycache__', 'target', 'build'])
export class Fault extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}
export async function inside(root: string, rel: unknown, kind: 'directory' | 'file') {
  if (
    typeof rel !== 'string' ||
    rel.length > 1024 ||
    /[\x00-\x1f:\\]/.test(rel) ||
    path.isAbsolute(rel) ||
    (rel !== '.' && rel.split('/').some((part) => !part || part.startsWith('.') || ignored.has(part)))
  ) {
    throw new Fault('Choose a relative path inside the workspace.')
  }
  const target = await realpath(path.join(root, rel)).catch(() => {
    throw new Fault('Path does not exist.', 404)
  })
  const diff = path.relative(root, target)
  if (
    diff.startsWith('..' + path.sep) ||
    diff === '..' ||
    path.isAbsolute(diff) ||
    diff.split(path.sep).some((part) => part.startsWith('.') || ignored.has(part))
  )
    throw new Fault('Path is outside the workspace.', 403)
  const info = await stat(target)
  if (!(kind === 'file' ? info.isFile() : info.isDirectory())) throw new Fault('Wrong path type.')
  return target
}
async function gitState(dir: string): Promise<Project['git']> {
  const git = executable('git')
  if (!git) return null
  try {
    const { stdout } = await exec(
      git,
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.untrackedCache=false',
        '-C',
        dir,
        'status',
        '--ignore-submodules=all',
        '--porcelain=v1',
        '--branch',
        '-z',
        '--untracked-files=normal',
        '--no-renames',
        '--',
        '.',
      ],
      { cwd: base, timeout: 3000, maxBuffer: 1048576, windowsHide: true },
    )
    const [head, ...changes] = stdout.split('\0')
    return {
      branch: head.replace(/^## (?:No commits yet on |Initial commit on )?/, '').split('...')[0],
      changed: changes.filter(Boolean).length,
    }
  } catch {
    return null
  }
}
export async function project(root: string, folder: string): Promise<Project> {
  const dir = await inside(root, folder, 'directory')
  const files: string[] = [],
    folders: string[] = []
  let count = 0,
    truncated = false
  for await (const item of await opendir(dir)) {
    if (++count > 1024) {
      truncated = true
      break
    }
    if (item.name.startsWith('.') || ignored.has(item.name)) continue
    if (item.isDirectory()) folders.push(item.name)
    if (item.isFile()) files.push(item.name)
  }
  return {
    folder,
    rootName: path.basename(root),
    files: files.sort(),
    folders: folders.sort(),
    truncated,
    git: await gitState(dir),
    demo: dir === (await realpath(example)),
  }
}
