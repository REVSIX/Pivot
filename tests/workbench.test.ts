import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, realpath, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { get } from 'node:http'
import { execFileSync } from 'node:child_process'
import { WebSocket } from 'ws'
import { createWorkbench } from '../server/app.ts'
import { inside, project, example } from '../server/workspace.ts'
import { csv, type Capture } from '../client/src/model.ts'

test('folder resolution confines canonical paths, including junctions', async (t) => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'pivot-path-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const root = await realpath(
    (await mkdir(path.join(scratch, 'root'), { recursive: true })) as string,
  )
  const outside = await mkdir(path.join(scratch, 'external'), { recursive: true })
  await writeFile(path.join(root, 'ok file.xml'), 'test')
  await symlink(outside!, path.join(root, 'escape'), 'junction')
  assert.equal(await inside(root, 'ok file.xml', 'file'), path.join(root, 'ok file.xml'))
  for (const rel of [
    '../external',
    '.git',
    'C:/outside',
    'x\\y',
    path.resolve(scratch),
    'escape',
    './bad',
    'node_modules',
  ]) {
    await assert.rejects(inside(root, rel, 'directory'))
  }
})
test('project status uses the chosen Git folder and omits private entries', async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'pivot-git-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q', '-b', 'test-branch', root])
  await writeFile(path.join(root, 'robot.xml'), 'ok')
  await writeFile(path.join(root, '.env'), 'private')
  const p = await project(root, '.')
  assert.deepEqual(p.files, ['robot.xml'])
  assert.deepEqual(p.folders, [])
  assert.equal(p.git?.branch, 'test-branch')
  assert.equal(p.git?.changed, 2)
})
test('local API enforces host, origin, session and file restrictions', async (t) => {
  const { server, close } = await createWorkbench({ root: path.dirname(example) })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(close)
  const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
    get(url + '/api/session', { headers: { Host: 'evil.example' } }, (res) => {
      res.resume()
      resolve(res.statusCode)
    }).on('error', reject)
  })
  assert.equal(wrongHost, 403)
  assert.equal(
    (await fetch(url + '/api/session', { headers: { Origin: 'https://evil.example' } })).status,
    403,
  )
  assert.equal((await fetch(url + '/api/project')).status, 403)
  const { token, initial } = await (await fetch(url + '/api/session')).json()
  assert.equal(initial, 'pendulum')
  const headers = { 'X-Pivot-Token': token, 'Content-Type': 'application/json' }
  assert.equal((await fetch(url + '/api/project?folder=..', { headers })).status, 400)
  const p = await (await fetch(url + '/api/project?folder=pendulum', { headers })).json()
  assert.equal(p.demo, true)
  assert.ok(p.files.includes('pendulum.xml'))
  const bad = await fetch(url + '/api/run', {
    method: 'POST',
    headers,
    body: JSON.stringify({ folder: 'pendulum', file: '../bad.xml' }),
  })
  assert.equal(bad.status, 400)
  for (const [origin, protocol] of [
    [url, 'pivot.invalid'],
    ['https://example.com', 'pivot.' + token],
  ]) {
    const ws = new WebSocket(url.replace('http:', 'ws:') + '/editor?folder=pendulum', protocol, {
      origin,
    })
    await assert.rejects(once(ws, 'open'), /403/)
  }
})
test('AdvantageScope table preserves every reference sample on simulation time', async () => {
  const r: Capture = JSON.parse(
    await readFile(new URL('../client/public/pendulum.capture.json', import.meta.url), 'utf8'),
  )
  const [header, ...rows] = csv(r).trimEnd().split('\n')
  assert.equal(header, 'Timestamp,/Sim/qpos/0,/Sim/qvel/0,/Sim/qpos/1,/Sim/qvel/1')
  assert.equal(rows.length, r.frames.length)
  r.frames.forEach((frame, i) => {
    assert.deepEqual(rows[i].split(',').map(Number), [
      frame.t,
      frame.q[0],
      frame.v[0],
      frame.q[1],
      frame.v[1],
    ])
    if (i) assert.ok(frame.t > r.frames[i - 1].t)
  })
})
