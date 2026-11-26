import express from 'express'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, lstat, mkdir, open, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { executable } from '../scripts/runtime.mjs'
import { Fault, inside, relativePath, tree } from './workspace.ts'
import { gitState, gitAction, diff, cloneRepo } from './git.ts'
import { tasks } from './tasks.ts'

const TEXT_LIMIT = 256 * 1024
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])
const revisionOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

async function readText(cwd: string, relative: unknown) {
  const file = await open(await inside(cwd, relative, 'file'), 'r')
  try {
    const size = (await file.stat()).size
    if (size > TEXT_LIMIT) throw new Fault('Preview supports text files up to 256 KiB.', 413)
    const buf = Buffer.alloc(size)
    const { bytesRead } = await file.read(buf, 0, size, 0)
    const data = buf.subarray(0, bytesRead)
    if (data.includes(0)) throw new Fault('This file is binary.', 415)
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
      return { text, revision: revisionOf(data), bom: data.subarray(0, 3).equals(UTF8_BOM) }
    } catch {
      throw new Fault('Preview supports UTF-8 text.', 415)
    }
  } finally {
    await file.close()
  }
}
async function saveText(cwd: string, file: unknown, target: string, mode: number, draft: unknown, revision: unknown) {
  if (typeof draft !== 'string' || draft.includes('\0') || typeof revision !== 'string')
    throw new Fault('Provide text and its original file revision.')
  const original = await readText(cwd, file)
  const unchanged = (actual: string) => {
    if (actual !== revision) throw new Fault('The file changed on disk. Copy your edits before reloading it.', 409)
  }
  unchanged(original.revision)
  const text = Buffer.from(draft, 'utf8')
  const bytes = original.bom ? Buffer.concat([UTF8_BOM, text]) : text
  if (bytes.length > TEXT_LIMIT) throw new Fault('The visual editor saves text files up to 256 KiB.', 413)
  await access(target, constants.W_OK)
  const temporary = path.join(path.dirname(target), '.pivot-save-' + randomUUID())
  const staged = await open(temporary, 'wx', mode & 0o777)
  try {
    try {
      await staged.writeFile(bytes)
      if (process.platform !== 'win32') await staged.chmod(mode & 0o777)
    } finally {
      await staged.close()
    }
    const latest = await lstat(target)
    if (!latest.isFile() || latest.isSymbolicLink())
      throw new Fault('The file changed on disk. Copy your edits before reloading it.', 409)
    unchanged((await readText(cwd, file)).revision)
    await rename(temporary, target)
    return { revision: revisionOf(bytes) }
  } catch (error) {
    await unlink(temporary).catch(() => {})
    throw error
  }
}
async function reveal(target: string) {
  const win = process.platform === 'win32',
    mac = process.platform === 'darwin'
  const bin = win
    ? path.join(process.env.SystemRoot || 'C:/Windows', 'explorer.exe')
    : executable(mac ? 'open' : 'xdg-open')
  if (!bin) throw new Fault('A desktop file manager is unavailable.', 503)
  const args = win ? ['/select,', target] : mac ? ['-R', target] : [path.dirname(target)]
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      windowsHide: false,
      stdio: 'ignore',
      detached: true,
    })
    child.once('error', () => reject(new Fault('Could not open the file manager.', 503)))
    child.once('spawn', () => {
      child.unref()
      resolve()
    })
  })
}
async function destination(cwd: string, relative: unknown) {
  const p = relativePath(relative)
  if (p === '.') throw new Fault('Choose an entry inside the selected project.')
  const parent = await inside(cwd, path.posix.dirname(p), 'directory')
  return path.join(parent, path.posix.basename(p))
}
async function fileAction(cwd: string, req: Record<string, unknown>) {
  const target = await destination(cwd, req.path)
  if (req.action === 'create') await writeFile(target, '', { flag: 'wx' })
  else if (req.action === 'mkdir') await mkdir(target)
  else {
    const info = await lstat(target)
    if (info.isSymbolicLink())
      throw new Fault('Link entries cannot be modified through the explorer.', 403)
    const existing = await inside(cwd, req.path, 'either')
    if (req.action === 'save') {
      if (!info.isFile()) throw new Fault('Choose a text file to save.')
      return await saveText(cwd, req.path, existing, info.mode, req.text, req.revision)
    } else if (req.action === 'rename') {
      const dest = await destination(cwd, req.to)
      if (
        await lstat(dest)
          .then(() => true)
          .catch((e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return false
            throw e
          })
      )
        throw new Fault('The destination already exists.', 409)
      await rename(existing, dest)
    } else if (req.action === 'delete') {
      if (req.confirm !== req.path) throw new Fault('Confirm the exact path to delete.', 409)
      if (info.isDirectory()) await rmdir(existing)
      else await unlink(existing)
    } else if (req.action === 'reveal') await reveal(existing)
    else throw new Fault('Unknown explorer action.')
  }
  return { ok: true }
}
export function projectRoutes(root: string): express.Router {
  const router = express.Router()
  const mutations = new Set<string>()
  async function change<T>(cwd: string, fn: () => Promise<T>) {
    if (mutations.has(cwd))
      throw new Fault('Another change is already in progress in this project.', 409)
    mutations.add(cwd)
    try {
      return await fn()
    } finally {
      mutations.delete(cwd)
    }
  }
  const folder = (v: unknown) => inside(root, v ?? '.', 'directory')
  router.get('/tree', async (req, res) =>
    res.json(await tree(await folder(req.query.folder), relativePath(req.query.path ?? '.'))),
  )
  router.get('/file', async (req, res) =>
    res.json(await readText(await folder(req.query.folder), req.query.path)),
  )
  router.post('/file', async (req, res) => {
    const cwd = await folder(req.body?.folder)
    try {
      res.json(await change(cwd, () => fileAction(cwd, req.body || {})))
    } catch (error) {
      const err = error as NodeJS.ErrnoException
      if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY')
        throw new Fault('Entry already exists, or the directory is not empty.', 409)
      if (err.code === 'ENOENT') throw new Fault('Entry no longer exists.', 404)
      throw error
    }
  })
  router.get('/git', async (req, res) => res.json(await gitState(await folder(req.query.folder))))
  router.get('/diff', async (req, res) =>
    res.json({
      text: await diff(await folder(req.query.folder), req.query.path, req.query.staged === '1', req.query.full === '1'),
    }),
  )
  router.post('/git', async (req, res) => {
    const cwd = await folder(req.body?.folder)
    res.json(await change(cwd, () => gitAction(cwd, req.body || {})))
  })
  router.post('/clone', async (req, res) => {
    const p = relativePath(req.body?.folder ?? '.')
    res.json(await change(await folder(p), () => cloneRepo(root, p, req.body?.url, req.body?.name)))
  })
  router.get('/tasks', async (req, res) => res.json(await tasks(await folder(req.query.folder))))
  return router
}
