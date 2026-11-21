import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as wait } from 'node:timers/promises'

const [install, upgradeWorkspace] = process.argv.slice(2)
if (!install) throw new Error('Usage: node packaging/smoke-service.mjs <installed Pivot directory>')
const root = upgradeWorkspace ?? await mkdtemp(path.join(os.tmpdir(), 'pivot-service-smoke-'))
const service = spawn(path.join(install, 'node.exe'), ['desktop/service.ts', root, '0'], {
  cwd: path.join(install, 'app'),
  stdio: ['pipe', 'pipe', 'inherit'],
  windowsHide: true,
})
const exited = once(service, 'exit')
const lines = createInterface({ input: service.stdout })
try {
  const portReady = new Promise((resolve) => {
    lines.on('line', (line) => {
      const port = /^PIVOT_READY (\d+)$/.exec(line)?.[1]
      if (port) resolve(port)
    })
  })
  service.stdin.write('start\n')
  const port = await Promise.race([
    portReady,
    exited.then(([code]) => { throw new Error('Installed service exited before readiness (' + code + ')') }),
    wait(25000, null, { ref: false }),
  ])
  assert.ok(port, 'Installed service did not start')
  const origin = 'http://127.0.0.1:' + port
  const response = await fetch(origin, { signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  assert.match(await response.text(), /<title>Pivot/)
  const { token } = await (await fetch(origin + '/api/session')).json()
  assert.ok(token)
  const project = await (await fetch(origin + '/api/project?folder=.', {
    headers: { 'X-Pivot-Token': token },
  })).json()
  assert.equal(project.rootName, path.basename(root))
  if (upgradeWorkspace) {
    const request = async (route, body) => {
      const result = await fetch(origin + '/api/' + route, {
        method: 'POST',
        headers: { 'X-Pivot-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await result.json()
      assert.ok(result.ok, JSON.stringify(data))
      return data
    }
    const opened = await request('sim/open', { folder: '.', file: '@cart-pole' })
    const step = await request('sim/' + opened.id + '/action', { action: 'step' })
    assert.ok(step.frames.at(-1).t > 0)
    await request('sim/' + opened.id + '/action', { action: 'close' })
    console.log('Live MuJoCo loaded and advanced with the installed Python environment.')
  }
  service.stdin.write('stop\n')
  assert.equal(await Promise.race([exited.then(([code]) => code), wait(10000, null, { ref: false })]), 0)
  await assert.rejects(fetch(origin + '/api/session', { signal: AbortSignal.timeout(5000) }))
  console.log('Installed runtime served the workbench and closed cleanly.')
} finally {
  lines.close()
  if (service.exitCode === null && service.signalCode === null) service.kill()
}
