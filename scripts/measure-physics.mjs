import path from 'node:path'
import { once } from 'node:events'
import { cpus } from 'node:os'
import { createWorkbench } from '../server/app.ts'
import { base } from './runtime.mjs'

const wb=await createWorkbench({root:path.join(base,'examples')})
wb.server.listen(0,'127.0.0.1');await once(wb.server,'listening')
const url='http://127.0.0.1:'+wb.server.address().port+'/api'
try{
  const {token}=await(await fetch(url+'/session')).json()
  async function post(route,body){
    const res=await fetch(url+route,{method:'POST',headers:{'X-Pivot-Token':token,'Content-Type':'application/json'},body:JSON.stringify(body)})
    if(!res.ok)throw Error(await res.text())
    return res.json()
  }
  const started=performance.now()
  const opened=await post('/sim/open',{folder:'pendulum',file:'pendulum.xml'})
  const openMs=performance.now()-started
  const latency=[]
  for(let i=0;i<50;i++){
    const tick=performance.now()
    await post('/sim/'+opened.id+'/action',{action:'step',after:i})
    latency.push(performance.now()-tick)
  }
  await post('/sim/'+opened.id+'/action',{action:'close'})
  latency.sort((a,b)=>a-b)
  const count=16000, batch=100
  const t0=performance.now()
  for(let start=0;start<count;start+=batch){
    await post('/telemetry',{folder:'pendulum',samples:Array.from({length:batch},(_,i)=>({
      t:(start+i)/1000,name:'sensor',unit:'rad',value:Math.sin((start+i)/100)
    }))})
  }
  const elapsed=performance.now()-t0
  const after=await fetch(url+'/telemetry?folder=pendulum&after=15999',{headers:{'X-Pivot-Token':token}})
  const data=await after.json()
  console.log(JSON.stringify({machine:cpus()[0].model,node:process.version,platform:process.platform,
    engine:opened.capture.engine,openMs:+openMs.toFixed(2),stepMedianMs:+latency[24].toFixed(2),
    stepP95Ms:+latency[47].toFixed(2),httpSamplesPerSec:Math.round(1000*count/elapsed),finalSeq:data.cursor,batch},null,2))
}finally{await wb.close()}
