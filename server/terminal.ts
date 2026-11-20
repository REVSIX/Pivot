// One short-lived helper owns each native PTY, including ConPTY's OS handles.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as wait } from 'node:timers/promises'
import { type Palette, isPalette } from '../shared/theme.ts'
import { themeExpression } from './nvim-theme.ts'
const { command, args, cwd, address } = JSON.parse(process.argv[2]) as {
  command: string
  args: string[]
  cwd: string
  address?: string
}
const nativePackage = 'node-pty'
type Input =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'open'; file: string }
  | { type: 'theme'; palette: Palette }
  | { type: 'run-file' }
  | { type: 'moved'; from: string; to: string }

const vimString=(value:string)=>"'" + value.replaceAll("'", "''") + "'"

async function remote(expression:string) {
  const started=Date.now()
  while(true) {
    try {
      const {stdout}=await promisify(execFile)(command,['--headless','--server',address!,'--remote-expr',expression],{timeout:3500,maxBuffer:65536,cwd,windowsHide:true})
      return stdout.trim()
    } catch(error) {
      if(!process.connected || Date.now()-started>3500 || !/connect|socket|pipe/i.test(String(error))) throw error
      await wait(120)
    }
  }
}
try {
  const { spawn } = await import(nativePackage)
  const term = spawn(command, args, {
    cwd,
    env: process.env,
    cols: 96,
    rows: 30,
    name: 'xterm-256color',
    useConptyDll: process.platform === 'win32',
  })
  let pending = 0
  term.onData((data: string) => {
    if (!process.connected) return
    const size = Buffer.byteLength(data)
    pending += size
    if (pending > 2_097_152) {
      term.kill()
      return
    }
    process.send!({ type: 'data', data }, () => {
      pending -= size
    })
  })
  term.onExit(({exitCode}:{exitCode:number}) => {
    if(process.connected)process.send!({type:'exit',code:exitCode},()=>process.exit(exitCode===0?0:1))
    else process.exit(0)
  })
  let controls = Promise.resolve()
  process.on('message', (msg: Input) => {
    if (msg.type === 'input') term.write(msg.data)
    else if (msg.type === 'resize') term.resize(msg.cols, msg.rows)
    else if (address) {
      controls = controls
        .then(async () => {
          if(msg.type==='theme'){
            if(isPalette(msg.palette))await remote(themeExpression(msg.palette))
            return
          }
          if(msg.type==='open'){
            await remote("execute('hide edit ' . fnameescape(" + vimString(msg.file) + '))')
            return
          }
          if(msg.type==='run-file'){
            const result=JSON.parse(await remote('luaeval("PivotRunFile()")'))
            if(process.connected)process.send!({type:'run-result',file:result.file,error:result.error})
            return
          }
          const expression='luaeval("PivotMoveBuffers(_A)", ['+vimString(msg.from)+','+vimString(msg.to)+'])'
          const feedback=await remote(expression)
          if(feedback&&process.connected)process.send!({type:'notice',data:feedback})
        })
        .catch(() => {
          if (process.connected)
            process.send!({
              ...(msg.type==='run-file'
                ? {type:'run-result',error:'Could not read the active file from Neovim.'}
                : {type:'notice',data:'Neovim could not process the '+msg.type+' request. Check the editor prompt and retry.'}),
            })
        })
    }
  })
  process.once('disconnect', () => {
    term.kill()
    setTimeout(() => process.exit(0), 1500).unref()
  })
  if (!process.connected) {
    term.kill()
    process.exit(0)
  }
  process.send!({ type: 'ready' })
} catch {
  if (process.connected)
    process.send!(
      {
        type: 'error',
        data: 'Terminal unavailable. Check the selected executable and node-pty installation.',
      },
      () => process.exit(1),
    )
  else process.exit(1)
}
