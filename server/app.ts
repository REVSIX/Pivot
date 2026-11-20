import express from 'express'
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { base } from '../scripts/runtime.mjs'
import { Fault, project, example } from './workspace.ts'
import { runModel } from './simulation.ts'
import { attachEditor } from './editor.ts'
import { projectRoutes } from './project-api.ts'
import { telemetryRoutes } from './telemetry.ts'
import { liveSimulationRoutes } from './live-simulation.ts'
import { monkeytypeThemes } from './monkeytype.ts'

export async function createWorkbench(options: { root: string; dev?: boolean }) {
  const root = await realpath(options.root)
  if (!(await stat(root)).isDirectory()) throw new Error('Workspace root must be a folder.')
  const app = express()
  const server = createServer(app)
  const token = randomBytes(32).toString('hex')
  const host = () => '127.0.0.1:' + (server.address() as { port: number })?.port
  const closeEditor = attachEditor(server, root, token, host, options.dev)
  let simulation: AbortController | null = null
  app.disable('x-powered-by')
  app.use((req, res, next) => {
    if (
      req.headers.host !== host() ||
      (req.headers.origin && req.headers.origin !== 'http://' + host()) ||
      (req.path.startsWith('/api/') && req.get('Sec-Fetch-Site') === 'cross-site')
    ) {
      res.status(403).end()
      return
    }
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' ws://" +
        host() +
        "; img-src 'self' data:; frame-src https://open.spotify.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    })
    next()
  })
  app.use('/api', (_, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })
  app.get('/api/session', (_, res) =>
    res.json({ token, initial: root === path.dirname(example) ? 'pendulum' : '.' }),
  )
  app.use('/api', (req, res, next) => {
    if (req.get('X-Pivot-Token') !== token) {
      res.status(403).json({ error: 'Reload to reconnect to Pivot.' })
      return
    }
    next()
  })
  app.use('/api', express.json({ limit: '2mb' }))
  app.get('/api/themes/monkeytype',async(_,res)=>res.json(await monkeytypeThemes()))
  const live = liveSimulationRoutes(root,host,token)
  app.use('/api', projectRoutes(root), telemetryRoutes(), live.router)
  app.get('/api/project', async (req, res) => {
    res.json(await project(root, typeof req.query.folder === 'string' ? req.query.folder : '.'))
  })
  app.post('/api/run', async (req, res) => {
    if (simulation) throw new Fault('A simulation is already running.', 409)
    const job = new AbortController()
    simulation = job
    const cancel = () => {
      if (!res.writableEnded) job.abort()
    }
    res.on('close', cancel)
    try {
      res.json(await runModel(root, req.body?.folder, req.body?.file, job.signal))
    } finally {
      res.off('close', cancel)
      simulation = null
    }
  })
  app.use('/api', (_, res) => res.status(404).json({ error: 'Unknown API route.' }))
  let closeDev: undefined | (() => Promise<void>)
  if (options.dev) {
    const { createServer: vite } = await import('vite')
    const dev = await vite({
      configFile: path.join(base, 'vite.config.ts'),
      root: path.join(base, 'client'),
      server: {
        middlewareMode: true,
        hmr: { server, path: '/vite-hmr' },
        fs: { allow: [path.join(base, 'client'), path.join(base, 'node_modules'), path.join(base, 'shared')] },
      },
    })
    app.use(dev.middlewares)
    closeDev = () => dev.close()
  } else {
    app.use(express.static(path.join(base, 'dist')))
  }
  app.use(((err: Error & { status?: number }, _req, res, _next) => {
    res
      .status(err.status || 500)
      .json({ error: err.status ? err.message : 'Workbench request failed.' })
  }) as express.ErrorRequestHandler)
  return {
    server,
    close: async () => {
      simulation?.abort()
      live.close()
      closeEditor()
      await closeDev?.()
      server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}
