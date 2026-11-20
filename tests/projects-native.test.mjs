import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createWorkbench } from '../server/app.ts'

async function until(check, ms = 16000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for terminal output')
}
test(
  'two shell sessions and an editor can coexist and switch unsaved buffers',
  { timeout: 60000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pivot-shell-'))
    await mkdir(path.join(root, 'destination'))
    await writeFile(path.join(root, 'first.txt'), 'HELLO_FIRST\n')
    await writeFile(path.join(root, 'second.txt'), 'HELLO_SECOND\n')
    const wb = await createWorkbench({ root })
    wb.server.listen(0, '127.0.0.1')
    await once(wb.server, 'listening')
    const origin = 'http://127.0.0.1:' + wb.server.address().port
    const { token } = await (await fetch(origin + '/api/session')).json()
    const sockets = []
    t.after(async () => {
      for (const ws of sockets) ws.close()
      await wb.close()
      await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    })
    async function session(endpoint) {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + endpoint, 'pivot.' + token, {
        origin,
      })
      sockets.push(ws)
      const capture = { output: '', ready: false, send: (msg) => ws.send(JSON.stringify(msg)) }
      ws.on('message', (data, binary) => {
        if (binary && data.toString() === 'ready') capture.ready = true
        else capture.output += data.toString()
      })
      await until(() => capture.ready)
      return capture
    }
    const [a, b] = await Promise.all([session('/terminal?folder=.'), session('/terminal?folder=.')])
    for (const [s, marker] of [
      [a, 'one'],
      [b, 'two'],
    ]) {
      const cmd =
        process.platform === 'win32'
          ? "[IO.File]::WriteAllText((Join-Path (Get-Location) '" + marker + ".txt'),'shell')"
          : 'printf shell > ' + marker + '.txt'
      s.send({ type: 'input', data: cmd + '\r' })
      await until(() =>
        readFile(path.join(root, marker + '.txt'), 'utf8').then(
          (x) => x === 'shell',
          () => false,
        ),
      )
    }
    const editor = await session('/editor?folder=.&file=first.txt')
    await until(() => editor.output.includes('HELLO_FIRST'))
    editor.send({ type: 'input', data: ':call append(line("$"), "draft preserved")\r' })
    await until(() => editor.output.includes('draft preserved'))
    editor.send({ type: 'open', file: 'second.txt' })
    await until(() => editor.output.includes('HELLO_SECOND'))
    editor.send({ type: 'input', data: ':call append(line("$"), "second saved")\r:wa\r' })
    await until(() =>
      readFile(path.join(root, 'second.txt'), 'utf8').then((text) => text.includes('second saved')),
    )
    assert.match(await readFile(path.join(root, 'first.txt'), 'utf8'), /draft preserved/)
    editor.send({ type: 'input', data: ':call append(line("$"), "move draft")\r' })
    await until(() => editor.output.includes('move draft'))
    const destination = 'destination/second.txt'
    const moved = await fetch(origin + '/api/file', {
      method: 'POST',
      headers: { 'X-Pivot-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: '.', action: 'rename', path: 'second.txt', to: destination }),
    })
    assert.equal(moved.status, 200)
    editor.send({ type: 'moved', from: 'second.txt', to: destination })
    await until(() => editor.output.includes('destination'))
    editor.send({ type: 'input', data: ':w\r' })
    await until(async () => (await readFile(path.join(root, destination), 'utf8')).includes('move draft'))
    await assert.rejects(readFile(path.join(root, 'second.txt')), { code: 'ENOENT' })
    editor.send({ type: 'input', data: ':qa\r' })
  },
)
