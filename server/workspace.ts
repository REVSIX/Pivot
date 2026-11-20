import path from 'node:path'
import { realpathSync, statSync } from 'node:fs'
import { realpath, stat, opendir } from 'node:fs/promises'
import { base } from '../scripts/runtime.mjs'
import { gitState, excludedNames } from './git.ts'
import type { Project } from '../client/src/model.ts'

const customDemo = process.env.PIVOT_DEMO_DIR
if (customDemo && (!path.isAbsolute(customDemo) || !statSync(customDemo,{throwIfNoEntry:false})?.isDirectory()))
  throw new Error('PIVOT_DEMO_DIR must identify an existing absolute directory.')
export const example = customDemo ? realpathSync(customDemo) : path.join(base, 'examples', 'pendulum')
const omittedDirs = new Set(['node_modules', 'dist', 'build', 'target', '__pycache__'])
const dotfiles = new Set([
  '.gitignore',
  '.gitattributes',
  '.github',
  '.dockerignore',
  '.editorconfig',
  '.vscode',
  '.pivot-tasks.json',
])
export class Fault extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}
export function allowedName(name: string) {
  return Boolean(
    name &&
    !omittedDirs.has(name.toLowerCase()) &&
    (!name.startsWith('.') || dotfiles.has(name)) &&
    !/[\x00-\x1f<>:"/\\|?*]/.test(name) &&
    !/[ .]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name),
  )
}
export function relativePath(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    (value !== '.' && !value.split('/').every(allowedName))
  )
    throw new Fault('Choose a relative path inside the workspace.')
  return value
}
export async function inside(root: string, rel: unknown, kind: 'directory' | 'file' | 'either') {
  const target = await realpath(path.join(root, relativePath(rel))).catch(() => {
    throw new Fault('Path does not exist.', 404)
  })
  const diff = path.relative(root, target)
  if (path.isAbsolute(diff) || (diff && !diff.split(path.sep).every(allowedName)))
    throw new Fault('Path is outside the workspace.', 403)
  const info = await stat(target)
  if (
    kind === 'directory'
      ? !info.isDirectory()
      : kind === 'file'
        ? !info.isFile()
        : !info.isFile() && !info.isDirectory()
  )
    throw new Fault('Wrong path type.')
  return target
}
export async function tree(folderRoot: string, relative: string) {
  const cwd = await inside(folderRoot, relative, 'directory')
  const entries: { name: string; path: string; kind: 'file' | 'directory' }[] = []
  let scanned = 0
  for await (const ent of await opendir(cwd)) {
    if (++scanned > 2048) break
    if (!allowedName(ent.name) || (!ent.isFile() && !ent.isDirectory())) continue
    entries.push({
      name: ent.name,
      path: relative === '.' ? ent.name : relative + '/' + ent.name,
      kind: ent.isDirectory() ? 'directory' : 'file',
    })
  }
  const ignored = await excludedNames(
    cwd,
    entries.map((ent) => ent.name + (ent.kind === 'directory' ? '/' : '')),
  )
  const visible = entries
    .filter((ent) => !ignored.has(ent.name))
    .sort(
      (a, b) => Number(a.kind === 'file') - Number(b.kind === 'file') || a.name.localeCompare(b.name),
    )
  return { entries: visible, truncated: scanned > 2048 }
}
export async function project(root: string, folder: string): Promise<Project> {
  const dir = await inside(root, folder, 'directory')
  const listing = await tree(dir, '.')
  const git = await gitState(dir, false)
  return {
    folder,
    rootName: path.basename(root),
    files: listing.entries.filter((e) => e.kind === 'file').map((e) => e.name),
    folders: listing.entries.filter((e) => e.kind === 'directory').map((e) => e.name),
    truncated: listing.truncated,
    git: git.available ? { branch: git.branch, changed: git.changes.length } : null,
    demo: dir === (await realpath(example).catch(() => null)),
  }
}
