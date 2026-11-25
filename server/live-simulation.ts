import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import { base, pythonPath } from '../scripts/runtime.mjs'
import type { Capture, Frame } from '../client/src/model.ts'
import { Fault, inside } from './workspace.ts'
import { telemetryEnv } from './telemetry.ts'
import { builtInModel } from '../shared/models.ts'

/** A serialized request/reply pipe. Only the compiled-in worker receives commands. */
class NativeModel {
  child:ChildProcessWithoutNullStreams
  pending?: {resolve:(data:unknown)=>void;reject:(err:Error)=>void}
  private diagnostic=''
  private dead=false
  constructor(python:string,entry?:string,env?:NodeJS.ProcessEnv) {
    this.child=spawn(python,entry?['-u',entry,'--pivot-live']:['-I','-u',path.join(base,'simulator/run.py'),'--live'],{
      cwd:entry?path.dirname(entry):path.join(base,'simulator'),env:env?{...process.env,...env}:process.env,windowsHide:true,stdio:'pipe'})
    createInterface({input:this.child.stdout}).on('line',line=>{
      try{this.pending?.resolve(JSON.parse(line))}catch{this.pending?.reject(new Fault('Invalid native simulation response.',500))}
    })
    this.child.stderr.on('data',chunk=>{this.diagnostic=(this.diagnostic+String(chunk)).slice(-2048)})
    this.child.stdin.on('error',()=>{})
    this.child.on('error',()=>this.fail('MuJoCo could not start. Check the Python installation.'))
    this.child.on('close',()=>this.fail(this.diagnostic.trim()||'MuJoCo worker exited.'))
  }
  private fail(message:string){this.dead=true;this.pending?.reject(new Fault(message,422))}
  request<T>(message:object,timeoutMs=15000):Promise<T>{
    if(this.dead || this.pending)return Promise.reject(new Fault('Simulation worker unavailable.',503))
    return new Promise<T>((resolve,reject)=>{
      const timer=setTimeout(()=>{this.stop();reject(new Fault('MuJoCo worker timed out.',504))},timeoutMs)
      const clear=()=>{clearTimeout(timer);this.pending=undefined}
      this.pending={resolve:value=>{clear();resolve(value as T)},reject:err=>{clear();reject(err)}}
      this.child.stdin.write(JSON.stringify(message)+'\n')
    })
  }
  stop(){if(!this.dead)this.child.kill('SIGKILL');this.fail('Simulation closed.')}
}

const HISTORY=2048
class LiveSession {
  id=randomUUID()
  state:'paused'|'playing'|'error'|'closed'='paused'
  speed=1
  offset=0
  error=''
  private clock=0
  private pendingSeconds=0
  private chain:Promise<unknown>=Promise.resolve()
  private timer?:NodeJS.Timeout
  private ticking=false
  worker:NativeModel
  capture:Capture
  key:string
  constructor(worker:NativeModel,capture:Capture,key:string){this.worker=worker;this.capture=capture;this.key=key}
  cursor(){return this.offset+this.capture.frames.length-1}
  serial<T>(task:()=>Promise<T>):Promise<T>{const next=this.chain.then(task);this.chain=next.catch(()=>{});return next}
  private add(frames:Frame[]){
    this.capture.frames.push(...frames)
    const overflow=this.capture.frames.length-HISTORY
    if(overflow>0){this.capture.frames.splice(0,overflow);this.offset+=overflow}
  }
  private async tick(){
    if(this.state!=='playing')return
    const now=performance.now()
    this.pendingSeconds+=Math.min(.2,(now-this.clock)/1000)*this.speed
    this.clock=now
    const stride=Math.max(1,Math.round(.025/this.capture.dt))
    const period=stride*this.capture.dt
    const count=Math.min(64,Math.floor(this.pendingSeconds/period))
    if(!count)return
    this.pendingSeconds-=count*period
    this.add(await this.worker.request<Frame[]>({count,stride}))
  }
  private pause(){clearInterval(this.timer);this.timer=undefined;this.state='paused'}
  async action(action:unknown,speed:unknown){
    return this.serial(async()=>{
      if(this.state==='closed'||this.state==='error')throw new Fault(this.error||'Session closed.',410)
      if(action==='play' && this.state!=='playing'){
        this.clock=performance.now();this.pendingSeconds=0;this.state='playing'
        this.timer=setInterval(()=>{
          if(this.ticking)return
          this.ticking=true
          void this.serial(()=>this.tick()).catch(err=>{
            if(this.state!=='closed'){this.pause();this.state='error';this.error=err.message;this.worker.stop()}
          }).finally(()=>{this.ticking=false})
        },24)
        this.timer.unref()
      }else if(action==='pause'){this.pause()}
      else if(action==='step'){
        this.pause();this.add(await this.worker.request<Frame[]>({count:1,stride:1}))
      }else if(action==='reset'){
        this.pause();this.capture.frames=await this.worker.request<Frame[]>({reset:true});this.offset=0
      }else if(action==='speed'){
        if(typeof speed!=='number'||!Number.isFinite(speed)||speed<.1||speed>4)throw new Fault('Choose a speed from 0.1× to 4×.')
        this.speed=speed
      }else if(action!=='play')throw new Fault('Unknown simulation action.')
    })
  }
  snapshot(after:unknown){
    let n=after===undefined?-1:Number(after)
    if(!Number.isSafeInteger(n)||n< -1)throw new Fault('Invalid frame cursor.')
    if(n>this.cursor())n=-1
    const offset=Math.max(this.offset,n+1)
    return {state:this.state,speed:this.speed,cursor:this.cursor(),offset,
      frames:this.capture.frames.slice(offset-this.offset),...(this.error?{error:this.error}:{})}
  }
  stop(){this.pause();this.state='closed';this.worker.stop()}
}

export function liveSimulationRoutes(root:string,host:()=>string,token:string){
  const router=Router()
  let active:LiveSession|undefined,starting:NativeModel|undefined,opening=false,closed=false,expiry:NodeJS.Timeout|undefined
  const previews=new Set<NativeModel>()
  let external:{id:string;folder:string;run?:string;capture:Capture;offset:number;paused:boolean;reset:boolean;stop:boolean;last:number}|undefined
  const externalState=()=>{if(external&&Date.now()-external.last>(external.run?30000:5000))external.stop=true;return external}
  const externalSnapshot=(s:NonNullable<typeof external>,after:unknown)=>{const cursor=s.offset+s.capture.frames.length-1;const n=Number(after??-1);const offset=Math.max(s.offset,Number.isSafeInteger(n)?n+1:0);return {state:s.stop?'closed':s.paused?'paused':'playing',speed:1,cursor,offset,frames:s.capture.frames.slice(offset-s.offset)}}
  router.post('/sim/external',async(req,res)=>{
    const folder=req.body?.folder;await inside(root,folder,'directory')
    const capture=req.body?.capture as Capture
    if(!capture||!Array.isArray(capture.frames)||!Array.isArray(capture.nodes)||!Array.isArray(capture.geoms))throw new Fault('Invalid Python simulation state.')
    const run=req.body?.run
    if(run!==undefined&&(typeof run!=='string'||!/^[0-9a-f-]{36}$/i.test(run)))throw new Fault('Invalid embedded run ID.')
    capture.control=run?'passive':undefined
    const filename=(value:unknown)=>typeof value==='string'?value.split(/[\\/]/).at(-1)?.slice(0,255):undefined
    capture.source={script:filename(req.body?.script),model:filename(req.body?.model)}
    finish();external={id:randomUUID(),folder,run,capture,offset:0,paused:false,reset:false,stop:false,last:Date.now()}
    res.json({id:external.id})
  })
  router.post('/sim/external/frame',(req,res)=>{
    const s=externalState();if(!s||s.id!==req.body?.id)throw new Fault('Python simulation session closed.',410)
    s.last=Date.now();if(s.reset){s.capture.frames=[];s.offset=0}
    if(!s.paused&&!s.stop){
      s.capture.frames.push(req.body.frame as Frame)
      const extra=s.capture.frames.length-HISTORY;if(extra>0){s.capture.frames.splice(0,extra);s.offset+=extra}
    }
    res.json({paused:s.paused,reset:s.reset,stop:s.stop});s.reset=false
  })
  router.post('/sim/external/close',(req,res)=>{const s=external;if(s && s.id===req.body?.id)s.stop=true;res.json({closed:true})})
  router.get('/sim/active',(req,res)=>{
    const s=externalState(),run=req.query.run
    const matches=s&&s.folder===req.query.folder&&(run===undefined?!s.stop:s.run===run)
    res.json(matches?{id:s.id,capture:s.capture,...externalSnapshot(s,-1)}:{})
  })
  function finish(){clearTimeout(expiry);active?.stop();active=undefined}
  function touch(){clearTimeout(expiry);expiry=setTimeout(finish,120000);expiry.unref()}
  function find(id:string){if(!active||id!==active.id)throw new Fault('Simulation session expired. Run the model again.',410);touch();return active}
  async function resolveModel(folder:unknown,file:unknown){
    const dir=await inside(root,folder,'directory'),builtin=builtInModel(file)
    const model=builtin?path.join(base,'examples',builtin.path):await inside(dir,file,'file')
    if(path.extname(model).toLowerCase()!=='.xml'||(await stat(model)).size>65536)throw new Fault('Select an MJCF model under 64 KiB.')
    return {dir,builtin,model}
  }
  router.post('/sim/preview',async(req,res)=>{
    const {model}=await resolveModel(req.body?.folder,req.body?.file)
    const xml=await readFile(model,'utf8'),python=pythonPath()
    if(!python)throw new Fault('Configure the Pivot Python environment first.',503)
    if(closed||previews.size>=4)throw new Fault('Preview worker unavailable. Try again.',503)
    if(res.destroyed)return
    const worker=new NativeModel(python)
    const stop=()=>worker.stop()
    previews.add(worker)
    res.once('close',stop)
    try{
      const capture=await worker.request<Capture>({xml,preview:true})
      res.json({...capture,source:{model:path.basename(model)}})
    }
    finally{res.off('close',stop);previews.delete(worker);stop()}
  })
  router.post('/sim/open',async(req,res)=>{
    const {folder,file}=req.body||{}
    const {dir,builtin,model}=await resolveModel(folder,file)
    if(opening)throw new Fault('A model is already opening.',409)
    if(active && active.key!==model)throw new Fault('Close the current simulation before opening another model.',409)
    if(!active){
      const python=pythonPath()
      if(!python)throw new Fault('Configure the Pivot Python environment first.',503)
      opening=true
      try {
        const candidate=path.join(dir,'train.py')
        const entry=!builtin && (await stat(candidate).catch(()=>undefined))?.isFile() && (await readFile(candidate,'utf8')).includes('--pivot-live')
          ? await inside(dir,'train.py','file') : undefined
        const env=entry?{...telemetryEnv(folder,host(),token),PIVOT_MODEL_PATH:model,PIVOT_SIMULATOR_DIR:path.join(base,'simulator')}:undefined
        starting=new NativeModel(python,entry,env)
        const capture=await starting.request<Capture>({xml:entry?undefined:await readFile(model,'utf8')},entry?300000:15000)
        capture.source={model:path.basename(model),...(entry?{script:path.basename(entry)}:{})}
        if(closed)throw new Fault('Workbench closed.',503)
        active=new LiveSession(starting,capture,model)
      }catch(err){starting?.stop();throw err}finally{opening=false;starting=undefined}
    }
    touch()
    res.json({id:active.id,state:active.state,speed:active.speed,capture:active.capture,offset:active.offset,cursor:active.cursor()})
  })
  router.get('/sim/:id',(req,res)=>{const s=externalState();res.json(s?.id===req.params.id?externalSnapshot(s,req.query.after):find(req.params.id).snapshot(req.query.after))})
  router.post('/sim/:id/action',async(req,res)=>{
    const live=externalState()
    if(live?.id===req.params.id){const action=req.body?.action
      if(action==='play')live.paused=false
      else if(action==='pause')live.paused=true
      else if(action==='reset'&&!live.run){live.reset=true;live.paused=false}
      else if(action==='reset'||action==='step'&&live.run)throw new Fault('This viewer records physics owned by the script.',409)
      else if(action==='close'||action==='stop')live.stop=true
      else if(action!=='speed'&&action!=='step')throw new Fault('Unknown simulation action.')
      res.json(externalSnapshot(live,req.body?.after));return}
    const session=find(req.params.id)
    if(req.body?.action==='close'){
      finish();res.json({state:'closed',frames:[],offset:session.cursor()+1,cursor:session.cursor(),speed:session.speed});return
    }
    await session.action(req.body?.action,req.body?.speed)
    res.json(session.snapshot(req.body?.action==='reset'?-1:req.body?.after))
  })
  return {router,close:()=>{closed=true;external&&(external.stop=true);starting?.stop();for(const worker of previews)worker.stop();finish()}}
}
