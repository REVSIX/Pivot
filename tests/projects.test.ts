import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile, mkdir, rm, realpath, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { projectRoutes } from '../server/project-api.ts'

test('explorer, Git operation lifecycle, clone and task detection work on a real repository', async (t) => {
  const scratch = await realpath(await mkdtemp(path.join(os.tmpdir(), 'pivot-projects-')))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const dir = path.join(scratch, 'robot')
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true })
  await mkdir(dir)
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.name', 'Pivot Test')
  git(dir, 'config', 'user.email', 'pivot@localhost')
  await writeFile(path.join(dir, '.gitignore'), 'ignored/\n*.tmp\n')
  await mkdir(path.join(dir, 'ignored'))
  await writeFile(path.join(dir, 'ignored', 'internal.txt'), 'secret')
  await writeFile(path.join(dir, 'cache.tmp'), 'ignored')
  await writeFile(path.join(dir, 'controller.py'), 'print(1)\n')
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'node --version' } }),
  )
  await writeFile(
    path.join(dir, '.pivot-tasks.json'),
    JSON.stringify({ tasks: { analyze: 'python --version' } }),
  )
  git(dir, 'add', '.')
  git(dir, 'commit', '-qm', 'Initial controller')
  const app = express()
  app.use(express.json())
  app.use('/api', projectRoutes(scratch))
  app.use(((err, _req, res, _next) =>
    res.status(err.status || 500).json({ error: err.message })) as express.ErrorRequestHandler)
  const server = createServer(app)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/api/'
  async function get(endpoint: string) {
    const r = await fetch(url + endpoint)
    assert.equal(r.status, 200)
    return r.json()
  }
  async function post(endpoint: string, body: object, status = 200) {
    const r = await fetch(url + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: 'robot', ...body }),
    })
    const response = await r.json()
    assert.equal(r.status, status, JSON.stringify(response))
    return response
  }
  const tree = await get('tree?folder=robot&path=.')
  assert.deepEqual(tree.entries.map((e: { name: string }) => e.name).sort(), [
    '.gitignore',
    '.pivot-tasks.json',
    'controller.py',
    'package.json',
  ])
  const tasks = await get('tasks?folder=robot')
  assert.ok(tasks.tasks.some((s: { id: string }) => s.id === 'npm:test'))
  assert.ok(tasks.tasks.some((s: { id: string }) => s.id === 'project:analyze'))
  assert.equal((await get('file?folder=robot&path=controller.py')).text, 'print(1)\n')
  const editable = path.join(dir, 'visual.py')
  await writeFile(editable, '\uFEFFprint(1)\r\n')
  const initial = await get('file?folder=robot&path=visual.py')
  assert.equal(initial.text, 'print(1)\r\n')
  const draft = {action:'save', path:'visual.py', revision:initial.revision, text:'print(3)\r\n'}
  const saved = await post('file', draft)
  assert.equal(await readFile(editable, 'utf8'), '\uFEFFprint(3)\r\n')
  assert.notEqual(saved.revision, initial.revision)
  await post('file', draft, 409)
  await writeFile(editable, 'print("external")\n')
  await post('file', {...draft, revision:saved.revision}, 409)
  assert.equal(await readFile(editable, 'utf8'), 'print("external")\n')
  await post('file', {...draft, path:'../outside.py'}, 400)
  await rm(editable)
  await post('file', { action: 'mkdir', path: 'src' })
  await post('file', { action: 'create', path: 'src/notes.txt' })
  await post('file', { action: 'rename', path: 'src/notes.txt', to: 'src/run.txt' })
  await post('file', { action: 'delete', path: 'src', confirm: 'src' }, 409)
  await post('file', { action: 'delete', path: 'src/run.txt' }, 409)
  await post('file', { action: 'delete', path: 'src/run.txt', confirm: 'src/run.txt' })
  await post('file', { action: 'delete', path: 'src', confirm: 'src' })
  await post('file', { action: 'create', path: '../leak' }, 400)
  await post('file', { action: 'create', path: 'controller.py' }, 409)
  const external = path.join(scratch, 'other')
  await mkdir(external)
  await symlink(external, path.join(dir, 'escape'), 'junction')
  await post('file', { action: 'create', path: 'escape/leak.py' }, 403)
  await rm(path.join(dir, 'escape'))
  await writeFile(path.join(dir, 'controller.py'), 'print(2)\n')
  assert.match((await get('diff?folder=robot&path=controller.py')).text, /\+print\(2\)/)
  await post('git', { action: 'stage', path: 'controller.py' })
  let state = await get('git?folder=robot')
  assert.deepEqual(state.changes, [{ path: 'controller.py', index: 'M', worktree: ' ' }])
  await post('git', { action: 'unstage', path: 'controller.py' })
  await post('git', { action: 'checkout', branch: 'main' }, 409)
  await post('git', { action: 'stage', path: 'controller.py' })
  await post('git', { action: 'commit', message: 'Tune controller' })
  await post('git', { action: 'branch', branch: 'tuning' })
  state = await get('git?folder=robot')
  assert.equal(state.branch, 'tuning')
  assert.deepEqual(state.changes, [])
  await post('git', { action: 'checkout', branch: 'main' })
  const clone = await post('clone', { folder: '.', url: 'robot', name: 'copy' })
  assert.equal(clone.folder, 'copy')
  assert.match(await readFile(path.join(scratch, 'copy/controller.py'), 'utf8'), /print\(2\)/)
  await post('clone', { folder: '.', url: 'robot', name: 'copy' }, 409)
  await post('clone', { folder: '.', url: 'ext::repo', name: 'no' }, 400)
  const bare = path.join(scratch, 'upstream.git')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  git(dir, 'remote', 'add', 'origin', bare)
  await post('git', { action: 'push' })
  await post('git', { action: 'fetch' })
  await post('git', { action: 'pull' })
  assert.equal(git(dir, 'rev-parse', 'HEAD').trim(), git(bare, 'rev-parse', 'main').trim())
  await writeFile(path.join(dir, '.gitattributes'), '*.py filter=unsafe\n')
  await writeFile(path.join(dir, 'controller.py'), 'print("changed after commit")\n')
  git(dir,'config','filter.unsafe.clean','echo invoked > FILTER_EXECUTED && cat')
  await get('git?folder=robot')
  await get('diff?folder=robot&path=controller.py')
  await assert.rejects(readFile(path.join(dir, 'FILTER_EXECUTED')), {code:'ENOENT'})
})
