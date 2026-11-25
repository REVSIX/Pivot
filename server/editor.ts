import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { fork, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { existsSync } from 'node:fs'
import { base, editorEnv, editorHome, nvimPath, profile, executable, pythonPath } from '../scripts/runtime.mjs'
import { inside, relativePath } from './workspace.ts'
import { ghPath, taskCommand } from './tasks.ts'
import { telemetryEnv } from './telemetry.ts'
import { isPalette, isTheme, themes } from '../shared/theme.ts'

type Output = { type: 'ready' } | {type:'exit';code:number} |
  {type:'run-result';file?:string;error?:string} | { type: 'data' | 'error' | 'notice'; data: string }
type Launch = { command: string; args: string[]; cwd: string; address?: string }
function projectPython(cwd:string){
  const file=path.join(cwd,process.platform==='win32'?'.venv/Scripts/python.exe':'.venv/bin/python')
  return executable('python',file)
}
function fileRunner(cwd:string,file:string,embeddedArgs?:string[]):Launch {
  const extension=path.extname(file).toLowerCase()
  if(embeddedArgs){
    if(extension!=='.py')throw new Error('Open a Python script to run in the embedded viewer.')
    const command=projectPython(cwd)||pythonPath()||executable('python3')
    if(!command)throw new Error('Configure Python or create a .venv in the project root.')
    return {command,args:['-u',path.join(base,'telemetry/run_embedded.py'),file,...embeddedArgs],cwd}
  }
  let command:string|undefined,args:string[]=[]
  switch(extension){
    case '.py': command=pythonPath()||executable('python3')||projectPython(cwd);args=['-u'];break
    case '.js': case '.mjs': command=process.execPath;break
    case '.sh': command=executable('bash');break
    case '.ps1': command=executable('pwsh')||executable('powershell');args=['-NoProfile','-File'];break
    default: throw new Error('Run supports .py, .js, .mjs, .sh and .ps1. Use a project task for builds and firmware.')
  }
  if(!command)throw new Error('No runner installed for '+extension+' files.')
  return {command,args:[...args,file],cwd}
}
function shell(cwd: string, mode: string | null): Launch {
  if (mode === 'serial') {
    const command = process.env.PIVOT_PLATFORMIO
      ? executable('pio', process.env.PIVOT_PLATFORMIO)
      : executable('pio') || executable('platformio')
    if (!command) throw new Error('Install PlatformIO Core and add pio to PATH to open Serial Monitor.')
    return { command, args: ['device', 'monitor'], cwd }
  }
  if (mode === 'wsl') {
    const command = process.platform === 'win32' && executable('wsl')
    if (!command) throw new Error('Install a WSL distribution to use this shell.')
    return { command, args: ['--cd', cwd], cwd }
  }
  if (process.platform === 'win32') {
    const command = executable('powershell') || executable('pwsh')
    if (!command) throw new Error('Install PowerShell to start a Windows terminal.')
    return { command, args: ['-NoLogo', '-NoProfile'], cwd }
  }
  const command = executable('bash') || executable('sh')
  if (!command) throw new Error('No compatible shell found.')
  return {
    command,
    args: path.basename(command) === 'bash' ? ['--noprofile', '--norc', '-i'] : ['-i'],
    cwd,
  }
}
function nvim(cwd: string, target: string, user: boolean): Launch {
  const command = nvimPath()
  if (!command) throw new Error('Install Neovim or configure PIVOT_NVIM.')
  if (!user && !existsSync(path.join(editorHome, 'ready')))
    throw new Error('Run npm run setup:editor to install the Pivot LazyVim profile.')
  const id = 'pivot-' + randomUUID()
  const address =
    process.platform === 'win32' ? '\\\\.\\pipe\\' + id : path.join(os.tmpdir(), id + '.sock')
  const runner = path.join(base, 'editor', 'run.lua').replaceAll('\\', '/')
  const args = [
    '--listen', address, ...(user ? [] : ['-u', profile]),
    '-c', 'lua dofile(' + JSON.stringify(runner) + ')', '--', target,
  ]
  return { command, args, cwd, address }
}
export function attachEditor(
  server: Server,
  root: string,
  token: string,
  host: () => string,
  dev = false,
) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768, perMessageDeflate: false })
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
    const protocol = request.headers['sec-websocket-protocol']
    if (dev && sameOrigin && url.pathname === '/vite-hmr' && protocol === 'vite-hmr') return
    const editor = url.pathname === '/editor'
    if (!sameOrigin || (!editor && url.pathname !== '/terminal') || protocol !== 'pivot.' + token) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      return
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      if (wss.clients.size > 12) {
        ws.close(1008, 'Close a terminal before opening another session.')
        return
      }
      let child: ChildProcess | undefined,
        ready = false,
        task: string | undefined
      const folder = url.searchParams.get('folder') || '.'
      let cwd: string
      let chain = Promise.resolve()
      const errorText = (err: unknown) =>
        err instanceof Error ? err.message : 'Terminal request failed.'
      function notice(message: string) {
        if (ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify({ notice: message }), { binary: true })
      }
      ws.on('error', () => ws.terminate())
      ws.on('close', () => {
        if (child?.connected) child.disconnect()
      })
      async function launch() {
        cwd = await inside(root, folder, 'directory')
        const file = url.searchParams.get('file')
        const user = url.searchParams.get('profile') === 'user'
        const mode = url.searchParams.get('shell')
        const wsl = mode === 'wsl'
        const target = file && editor ? await inside(cwd, file, 'file') : cwd
        const runFile = !editor && url.searchParams.get('runFile')
        const embedded = !editor && url.searchParams.get('embedded')
        let args:string[]|undefined
        if(embedded){
          if(!runFile||wsl||!/^[0-9a-f-]{36}$/i.test(embedded))throw new Error('Invalid embedded viewer launch.')
          const raw=url.searchParams.get('args')||'[]'
          if(raw.length>4096)throw new Error('Embedded script arguments exceed 4096 characters.')
          const parsed:unknown=JSON.parse(raw)
          if(!Array.isArray(parsed)||parsed.some(value=>typeof value!=='string'||value.includes('\0')))
            throw new Error('Enter script arguments as a JSON array of strings.')
          args=parsed
        }
        const spec = editor ? nvim(cwd, target, user) :
          runFile ? fileRunner(cwd,await inside(cwd,runFile,'file'),args) : shell(cwd, mode)
        const launchTask = url.searchParams.get('task')
        if (!editor && !runFile && launchTask) task = await taskCommand(cwd, launchTask)
        let env: NodeJS.ProcessEnv =
          editor && !user
            ? editorEnv()
            : { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
        if (!wsl) {
          const instrumentation = telemetryEnv(folder, host(), token,embedded?spec.command:undefined)
          const paths = [
            ...instrumentation.PATH.split(path.delimiter),
            ...(env.PATH || '').split(path.delimiter),
          ]
          env = {
            ...env,
            ...instrumentation,
            PATH: [...new Set(paths.filter(Boolean))].join(path.delimiter),
          }
        }
        if(embedded)env.PIVOT_EMBEDDED_RUN=embedded
        const gh = ghPath()
        if (gh && !wsl) env.PATH = path.dirname(gh) + path.delimiter + (env.PATH || '')
        // Native Windows uses the first case-insensitive PATH key it finds.
        if (process.platform === 'win32') {
          env.PATH ??= env.Path || process.env.PATH || ''
          for (const key of Object.keys(env))
            if (key.toLowerCase() === 'path' && key !== 'PATH') delete env[key]
        }
        if (ws.readyState !== WebSocket.OPEN) return
        child = fork(path.join(base, 'server', 'terminal.ts'), [JSON.stringify(spec)], {
          cwd: base,
          env,
          execArgv: [],
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        })
        child.on('message', (msg: Output) => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (msg.type === 'error') return ws.close(1011, msg.data.slice(0, 100))
          if (msg.type === 'notice') return notice(msg.data)
          if (msg.type === 'run-result'){
            let result:{file?:string;error?:string}
            try{
              if(!msg.file)throw new Error(msg.error||'Open a file in Neovim first.')
              const file=path.relative(cwd,msg.file).split(path.sep).join('/')
              if(!file||path.isAbsolute(file)||file.startsWith('../'))throw new Error('Open a file inside this project to run it.')
              fileRunner(cwd,msg.file)
              result={file}
            }catch(error){result={error:errorText(error)}}
            return ws.send(JSON.stringify({runResult:result}),{binary:true})
          }
          if (msg.type==='exit'){
            const reason=editor?'Editor exited.':runFile?`Process exited (${msg.code}).`:'Terminal exited.'
            return ws.close(msg.code===0?1000:1011,reason)
          }
          if (msg.type === 'ready') {
            ready = true
            ws.send('ready', { binary: true })
            if (task) child?.send({ type: 'input', data: task + '\r' })
            return
          }
          if (msg.type === 'data') {
            if (ws.bufferedAmount > 2_097_152)
              return ws.close(1013, 'Terminal output exceeded client buffer.')
            ws.send(msg.data)
          }
        })
        child.on('error', () => ws.close(1011, 'Could not start the terminal process.'))
        child.on('close', (code) => {
          child = undefined
          if (ws.readyState === WebSocket.OPEN)
            ws.close(code === 0 ? 1000 : 1011, editor ? 'Editor exited.' : 'Terminal exited.')
        })
      }
      async function message(raw: Buffer) {
        if (!child?.connected || !ready) return
        let msg
        try {
          msg = JSON.parse(raw.toString())
        } catch {
          ws.close(1003, 'Invalid terminal message.')
          return
        }
        if (msg.type === 'input' && typeof msg.data === 'string')
          child.send({ type: 'input', data: msg.data })
        else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows))
          child.send({
            type: 'resize',
            cols: Math.max(16, Math.min(300, msg.cols)),
            rows: Math.max(5, Math.min(120, msg.rows)),
          })
        else if (editor && msg.type === 'open') {
          const file = await inside(cwd, msg.file, 'file')
          if (child?.connected) child.send({ type: 'open', file })
        } else if (editor && msg.type === 'run-file') {
          child.send({type:'run-file'})
        } else if (editor && msg.type === 'moved') {
          const from=relativePath(msg.from)
          const to=await inside(cwd,msg.to,'either')
          if(from!=='.'&&child?.connected)child.send({type:'moved',from:path.join(cwd,from),to})
        } else if (editor && msg.type === 'theme' && url.searchParams.get('profile')!=='user') {
          const name:unknown=msg.theme
          const palette=isTheme(name)?themes[name]:msg.palette
          if (!isPalette(palette)) throw new Error('Invalid editor palette.')
          child.send({type:'theme',palette})
        } else if (!editor && msg.type === 'task') {
          const command = await taskCommand(cwd, msg.id)
          if (child?.connected) child.send({ type: 'input', data: command + '\r' })
        }
      }
      ws.on('message', (raw) => {
        chain = chain.then(() => message(raw as Buffer)).catch((err) => notice(errorText(err)))
      })
      void launch().catch((err) => {
        if (ws.readyState === WebSocket.OPEN) ws.close(1011, errorText(err).slice(0, 100))
      })
    })
  })
  return () => {
    for (const client of wss.clients) client.terminate()
    wss.close()
  }
}
