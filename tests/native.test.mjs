import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, copyFile, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { WebSocket } from 'ws'
import { createWorkbench } from '../server/app.ts'
import { base } from '../scripts/runtime.mjs'
import { csv } from '../client/src/model.ts'

test('MuJoCo HTTP run, concurrent request, CSV export and verified terminal conversion', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hinge-native-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await copyFile(path.join(base, 'examples/pendulum/pendulum.xml'), path.join(root, 'arm.xml'))
  const { server, close } = await createWorkbench({ root })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(close)
  const url = 'http://127.0.0.1:' + server.address().port
  const { token } = await (await fetch(url + '/api/session')).json()
  const opts = {
    method: 'POST',
    headers: { 'X-Hinge-Token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder: '.', file: 'arm.xml' }),
  }
  const responses = await Promise.all([fetch(url + '/api/run', opts), fetch(url + '/api/run', opts)])
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409])
  const capture = await responses.find((r) => r.ok).json()
  assert.ok(capture.frames.length > 100)
  const file = path.join(root, 'arm run.csv')
  await writeFile(file, csv(capture))
  const { stdout } = await promisify(execFile)(process.execPath, [
    path.join(base, 'scripts/mcap.mjs'),
    file,
  ])
  assert.match(stdout, new RegExp(capture.frames.length + ' samples verified'))
  const mcap = await readFile(path.join(root, 'arm run.mcap'))
  assert.equal(mcap.subarray(0, 8).toString('hex'), '894d434150300d0a')
})
test('authenticated editor saves a buffer in the selected folder', { timeout: 25000 }, async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hinge-editor-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(root, 'notes.txt'), 'initial-line\n')
  const { server, close } = await createWorkbench({ root })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(close)
  const url = 'http://127.0.0.1:' + server.address().port
  const { token } = await (await fetch(url + '/api/session')).json()
  const socket = new WebSocket(
    url.replace('http:', 'ws:') + '/editor?folder=.&file=notes.txt',
    'hinge.' + token,
    { origin: url },
  )
  let sent = false
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.terminate()
      reject(new Error('Timed out waiting for Neovim to save and exit.'))
    }, 15000)
    socket.on('error', reject)
    socket.on('message', (data, binary) => {
      if (!binary && !sent && data.toString().includes('initial')) {
        sent = true
        const command = ':call append(line("$"), "saved by LazyVim")\r:wqa\r'
        socket.send(JSON.stringify({ type: 'input', data: command }))
      }
    })
    socket.on('close', (code, reason) => {
      clearTimeout(timeout)
      if (code === 1000) resolve()
      else reject(new Error(reason.toString()))
    })
  })
  assert.match(await readFile(path.join(root, 'notes.txt'), 'utf8'), /saved by LazyVim/)
})
