import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { fork, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { base, editorEnv, editorHome, nvimPath } from '../scripts/runtime.mjs'
import { inside } from './workspace.ts'
type Output = { type: 'ready' } | { type: 'data' | 'error'; data: string }

export function attachEditor(
  server: Server,
  root: string,
  token: string,
  host: () => string,
  dev = false,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false })
  let owner: WebSocket | undefined
  server.on('upgrade', (request, socket, head) => {
    let url: URL
    try {
      url = new URL(request.url || '/', 'http://127.0.0.1')
    } catch {
      socket.destroy()
      return
    }
    const sameOrigin =
      request.headers.host === host() && request.headers.origin === 'http://' + host()
    if (
      dev &&
      sameOrigin &&
      url.pathname === '/vite-hmr' &&
      request.headers['sec-websocket-protocol'] === 'vite-hmr'
    )
      return
    if (
      !sameOrigin ||
      url.pathname !== '/editor' ||
      request.headers['sec-websocket-protocol'] !== 'hinge.' + token
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (owner) {
        ws.close(1008, 'An editor is already open.')
        return
      }
      owner = ws
      function release() {
        if (owner === ws) owner = undefined
      }
      let child: ChildProcess | undefined
      ws.on('error', () => ws.terminate())
      ws.on('close', () => {
        if (child?.connected) child.disconnect()
        if (!child) release()
      })
      async function launch() {
        const cwd = await inside(root, url.searchParams.get('folder'), 'directory')
        const file = url.searchParams.get('file')
        const target = file ? await inside(cwd, file, 'file') : cwd
        const nvim = nvimPath()
        if (!nvim || !existsSync(path.join(editorHome, 'ready')))
          throw new Error('Run npm run setup:editor first. See README for Neovim setup.')
        if (ws.readyState !== WebSocket.OPEN) return
        child = fork(path.join(base, 'server', 'terminal.ts'), [nvim, cwd, target], {
          cwd: base,
          env: editorEnv(),
          execArgv: [],
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        })
        child.on('message', (msg: Output) => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (msg.type === 'error') return ws.close(1011, msg.data.slice(0, 100))
          if (msg.type === 'ready') return ws.send('ready', { binary: true })
          if (ws.bufferedAmount > 2_097_152)
            return ws.close(1013, 'Terminal output exceeded the client buffer.')
          ws.send(msg.data)
        })
        child.on('error', () => ws.close(1011, 'Could not start the terminal process.'))
        child.on('close', (code) => {
          release()
          child = undefined
          if (ws.readyState === WebSocket.OPEN)
            ws.close(
              code === 0 ? 1000 : 1011,
              code === 0 ? 'Editor exited.' : 'Editor process stopped.',
            )
        })
        ws.on('message', (raw) => {
          try {
            const msg = JSON.parse(raw.toString())
            if (!child?.connected) return
            if (msg.type === 'input' && typeof msg.data === 'string')
              child.send({ type: 'input', data: msg.data })
            else if (
              msg.type === 'resize' &&
              Number.isInteger(msg.cols) &&
              Number.isInteger(msg.rows)
            )
              child.send({
                type: 'resize',
                cols: Math.max(16, Math.min(300, msg.cols)),
                rows: Math.max(5, Math.min(120, msg.rows)),
              })
          } catch {
            ws.close(1003, 'Invalid terminal message.')
          }
        })
      }
      void launch().catch((err) => {
        if (ws.readyState === WebSocket.OPEN)
          ws.close(1011, String(err.message || 'Editor launch failed').slice(0, 100))
      })
    })
  })
  return () => {
    for (const client of wss.clients) client.terminate()
    wss.close()
  }
}
