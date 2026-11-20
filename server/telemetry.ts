import { Router } from 'express'
import { execFile } from 'node:child_process'
import path from 'node:path'
import { base, pythonPath } from '../scripts/runtime.mjs'
import { Fault } from './workspace.ts'

export interface Point {seq:number; name:string; t:number; value:number; unit:string}
function mcap(samples:Point[]){
  const python=pythonPath()
  if(!python)throw new Fault('Configure the Pivot Python environment to export MCAP.',503)
  if(samples.some(p=>p.t>=2**64/1e9))throw new Fault('A telemetry timestamp is outside the MCAP range.',422)
  return new Promise<Buffer>((resolve,reject)=>{
    const child=execFile(python,['-I','-X','utf8',path.join(base,'simulator/telemetry_mcap.py')],{
      encoding:'buffer',timeout:10000,maxBuffer:8*1024*1024,windowsHide:true,
    },(error,stdout,stderr)=>{
      if(error)reject(new Fault(
        stderr.includes("No module named 'mcap'")?
          'Install simulator/mcap-requirements.txt in the Pivot Python environment.':
          'Could not write the MCAP download.',503))
      else resolve(stdout)
    })
    child.stdin?.on('error',()=>{})
    child.stdin?.end(JSON.stringify(samples),'utf8')
  })
}

function telemetryCsv(samples:Point[]){
  const quote=(value:string)=>'"'+value.replaceAll('"','""')+'"'
  return ['Timestamp,Key,Value,Unit',...samples.map(p=>[p.t,quote(p.name),p.value,quote(p.unit)].join(','))].join('\r\n')+'\r\n'
}

const CAPACITY=8192
const MAX_CHANNELS=128
class Series {
  private ring=new Array<Point>(CAPACITY)
  private channels=new Map<string,Point>()
  cursor=0
  add(batch:Omit<Point,'seq'>[]){
    const names=new Set([...this.channels.keys(),...batch.map(p=>p.name)])
    if(names.size>MAX_CHANNELS)throw new Fault('Telemetry channel limit reached.',429)
    for(const p of batch){
      const point={...p,seq:++this.cursor}
      this.ring[(point.seq-1)%CAPACITY]=point;this.channels.set(point.name,point)
    }
  }
  snapshot(after:number){
    const first=Math.max(1,this.cursor-CAPACITY+1)
    const samples:Point[]=[]
    for(let seq=Math.max(first,after+1);seq<=this.cursor;seq++)samples.push(this.ring[(seq-1)%CAPACITY])
    return {samples,channels:Array.from(this.channels.values()),cursor:this.cursor,dropped:Math.max(0,first-1-after)}
  }
}
function scope(value:unknown){
  if(typeof value!=='string'||value.length>1024||!value || (value!=='.' && value.split('/').some(s=>!s||s.startsWith('.'))) || /[\\:\x00-\x1f]/.test(value))throw new Fault('Use a project-relative telemetry scope.')
  return value
}
function points(value:unknown):Omit<Point,'seq'>[]{
  if(!Array.isArray(value)||!value.length||value.length>128)throw new Fault('Send 1–128 samples per batch.')
  return value.map(p=>{
    if(!p||typeof p.name!=='string'||!p.name.trim()||p.name.length>96||/[\x00-\x1f]/.test(p.name)||
       typeof p.t!=='number'||!Number.isFinite(p.t)||p.t<0||typeof p.value!=='number'||!Number.isFinite(p.value)||
       typeof p.unit!=='string'||p.unit.length>24||/[\x00-\x1f]/.test(p.unit))throw new Fault('Invalid numerical telemetry sample.')
    return {name:p.name,t:p.t,value:p.value,unit:p.unit}
  })
}
export function telemetryRoutes(){
  const router=Router(), scopes=new Map<string,Series>()
  router.get('/telemetry',(req,res)=>{
    const key=scope(req.query.folder??'.'),after=Number(req.query.after??0)
    if(!Number.isSafeInteger(after)||after<0)throw new Fault('Invalid telemetry cursor.')
    const series=scopes.get(key)
    res.json(series?series.snapshot(after>series.cursor?0:after):{samples:[],channels:[],cursor:0,dropped:0})
  })
  router.post('/telemetry',(req,res)=>{
    const key=scope(req.body?.folder), batch=points(req.body?.samples)
    const series=scopes.get(key)??new Series()
    series.add(batch)
    // Retain at most eight active project scopes. Reads do not keep abandoned scopes alive.
    scopes.delete(key);scopes.set(key,series)
    if(scopes.size>8)scopes.delete(scopes.keys().next().value!)
    res.json({cursor:series.cursor,count:batch.length})
  })
  router.post('/telemetry/clear',(req,res)=>{
    scopes.delete(scope(req.body?.folder))
    res.json({cursor:0})
  })
  router.get('/telemetry/export/:format',async(req,res)=>{
    const format=req.params.format
    if(format!=='csv'&&format!=='mcap')throw new Fault('Choose CSV or MCAP.',404)
    const samples=scopes.get(scope(req.query.folder??'.'))?.snapshot(0).samples
    if(!samples?.length)throw new Fault('No telemetry to export.',404)
    const data=format==='csv'?telemetryCsv(samples):await mcap(samples)
    res.attachment('pivot-telemetry.'+format)
      .type(format==='csv'?'text/csv':'application/octet-stream')
      .set('X-Pivot-Samples',String(samples.length)).send(data)
  })
  return router
}
export function telemetryEnv(folder:string,host:string,token:string){
  const python=pythonPath(), sdk=path.join(base,'telemetry'), bins=[path.join(sdk,'bin')]
  if(python)bins.push(path.dirname(python))
  return {PIVOT_TELEMETRY_URL:'http://'+host,PIVOT_TELEMETRY_TOKEN:token,PIVOT_TELEMETRY_FOLDER:folder,
    PIVOT_SIMULATOR_DIR:path.join(base,'simulator'),
    PIVOT_PYTHON:python||'',PYTHONPATH:[sdk,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
    PATH:[...bins,process.env.PATH].filter(Boolean).join(path.delimiter)}
}
