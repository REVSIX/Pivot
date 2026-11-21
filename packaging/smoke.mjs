// Exercise the installed desktop, its owned service, and profile restoration.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import os from 'node:os'
import path from 'node:path'
import {setTimeout as wait} from 'node:timers/promises'

const [exe,nextExe]=process.argv.slice(2)
if(!exe) throw new Error('Usage: node packaging/smoke.mjs <installed Pivot.exe> [new Pivot.exe]')
const scratch=await mkdtemp(path.join(os.tmpdir(),'pivot-desktop-smoke-'))
const profile=path.join(scratch,'profile'), root=path.join(scratch,'robot project')
await mkdir(root)
const socket=createServer()
socket.listen(0,'127.0.0.1');await once(socket,'listening')
const debugPort=socket.address().port
await new Promise(resolve=>socket.close(resolve))
const debuggerBase='http://127.0.0.1:'+debugPort
async function pageTarget(child) {
  for(let i=0;i<160;i++){
    if(child.exitCode!==null || child.signalCode!==null)
      throw new Error('Pivot exited before loading the workbench: '+(child.exitCode ?? child.signalCode))
    const startupError=await readFile(path.join(profile,'startup-error.txt'),'utf8').catch(()=>null)
    if(startupError)throw new Error('Pivot startup failed:\n'+startupError)
    try {
      const targets=await (await fetch(debuggerBase+'/json/list',{signal:AbortSignal.timeout(1000)})).json()
      const page=targets.find(t=>t.type==='page' && t.url.startsWith('http://127.0.0.1:') && /pivot/i.test(t.title))
      if(page)return page
    }catch {}
    await wait(200)
  }
  throw new Error('Desktop did not load the workbench.')
}
async function session(args,upgraded=false) {
  const t0=performance.now()
  const child=spawn(upgraded?nextExe:exe,args,{
    env:{...process.env,PIVOT_DESKTOP_PROFILE:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port='+debugPort},
    stdio:'ignore',
  })
  const ended=once(child,'exit')
  let cdp
  try {
    const page=await pageTarget(child)
    const origin=new URL(page.url).origin
    const session=await (await fetch(origin+'/api/session')).json()
    assert.ok(session.token)
    const project=await (await fetch(origin+'/api/project?folder=.',{headers:{'X-Pivot-Token':session.token}})).json()
    assert.equal(project.rootName,path.basename(root))
    cdp=new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((resolve,reject)=>{cdp.onopen=resolve;cdp.onerror=reject})
    let id=0
    async function evaluate(expression) {
      const req=++id
      const reply=new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>{cdp.removeEventListener('message',receive);reject(new Error('CDP timed out.'))},5000)
        function receive(e){
          const msg=JSON.parse(e.data)
          if(msg.id!==req)return
          clearTimeout(timer);cdp.removeEventListener('message',receive)
          if(msg.error || msg.result.exceptionDetails)reject(new Error('CDP evaluation failed'))
          else resolve(msg.result.result.value)
        }
        cdp.addEventListener('message',receive)
      })
      cdp.send(JSON.stringify({id:req,method:'Runtime.evaluate',params:{expression,returnByValue:true}}))
      return reply
    }
    const visible=await evaluate('document.body.innerText')
    assert.match(visible,/simulation/i)
    assert.match(visible,/pivot/i)
    if(nextExe&&!upgraded){
      await evaluate("localStorage.setItem('pivot.theme',JSON.stringify('nord'));true")
    } else if(upgraded){
      for(let attempt=0;attempt<30;attempt++){
        if(await evaluate("document.getElementById('active-theme')?.textContent==='Nord'"))break
        await wait(100)
      }
      assert.equal(await evaluate("document.getElementById('active-theme').textContent"),'Nord')
      console.log('The upgraded desktop applied the previous theme.')
    }
    console.log('Workbench loaded in '+Math.round(performance.now()-t0)+' ms at '+origin)
    // The test workspace is empty. It is safe to close without interactive unsaved-session prompts.
    await evaluate("window.addEventListener('beforeunload', e=>e.stopImmediatePropagation(), true);window.chrome.webview.postMessage('close');true")
    const timeout=Symbol('timeout')
    const result=await Promise.race([ended,wait(12000,timeout,{ref:false})])
    assert.notEqual(result,timeout,'Host did not close')
    assert.equal(result[0],0)
    await assert.rejects(fetch(origin+'/api/session'))
    return origin
  }finally{
    cdp?.close()
    if(child.exitCode===null && child.signalCode===null)child.kill()
  }
}
const first=await session(['--root',root])
const second=await session([],!!nextExe)
assert.equal(first,second)
assert.ok((await readFile(path.join(profile,'window.xml'),'utf8')).includes(root))
console.log('Desktop launch, service shutdown, origin and project restoration passed.')
