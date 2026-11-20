import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp,readFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import express from 'express'
import { base,pythonPath } from '../scripts/runtime.mjs'
import { liveSimulationRoutes } from '../server/live-simulation.ts'
import { telemetryEnv,telemetryRoutes } from '../server/telemetry.ts'

const exec=promisify(execFile)
async function service(t) {
  const token='native-test-token',app=express(),live=liveSimulationRoutes(path.join(base,'examples'))
  app.use((req,res,next)=>req.get('X-Pivot-Token')===token?next():res.status(403).end())
  app.use('/api',express.json({limit:'64kb'}),live.router,telemetryRoutes())
  const server=app.listen(0,'127.0.0.1')
  await once(server,'listening')
  t.after(async()=>{live.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const host='127.0.0.1:'+server.address().port
  async function call(suffix,body){
    const res=await fetch('http://'+host+'/api/'+suffix,{method:body?'POST':'GET',
      headers:{'Content-Type':'application/json','X-Pivot-Token':token},body:body&&JSON.stringify(body)})
    if(!res.ok)throw new Error(await res.text())
    return res.json()
  }
  return {call,env:{...process.env,...telemetryEnv('pendulum',host,token)}}
}
test('live MuJoCo opens, steps one dt, advances continuously, pauses, resets and closes',async t=>{
  const {call}=await service(t)
  const opened=await call('sim/open',{folder:'pendulum',file:'pendulum.xml'})
  assert.equal(opened.state,'paused')
  assert.equal(opened.capture.frames[0].t,0)
  assert.equal(opened.capture.actuators.length,2)
  assert.equal(opened.capture.frames[0].xyz[0].length,3)
  assert.deepEqual(opened.capture.frames[0].actuatorForce,[.24,-.11])
  const url='sim/'+opened.id
  const act=(action,extra={})=>call(url+'/action',{action,...extra})
  const one=await act('step',{after:0})
  assert.equal(one.frames[0].t,opened.capture.dt)
  await act('speed',{speed:2})
  await act('play')
  let moving
  for(let n=0;n<20;n++){
    await new Promise(r=>setTimeout(r,25))
    moving=await call(url+'?after=1')
    if(moving.cursor>3)break
  }
  assert.ok(moving.frames.at(-1).t>one.frames[0].t)
  assert.notDeepEqual(moving.frames.at(-1).q,one.frames[0].q)
  const frozen=await act('pause')
  await new Promise(r=>setTimeout(r,60))
  assert.equal((await call(url+'?after='+frozen.cursor)).frames.length,0)
  const reset=await act('reset')
  assert.equal(reset.cursor,0);assert.deepEqual(reset.frames[0],opened.capture.frames[0])
  assert.equal((await act('close')).state,'closed')
})
test('SDK sends real batched samples and CLI lists, graphs and records them',async t=>{
  const {call,env}=await service(t)
  const dir=await mkdtemp(path.join(tmpdir(),'pivot-telem-'))
  t.after(()=>rm(dir,{recursive:true,force:true}))
  const python=pythonPath(), cli=path.join(base,'telemetry/telem.py')
  assert.ok(python)
  const src='import ide_telem as ide\nfor i in range(200):\n torque=i/4\n ide.log(torque,unit="N·m",timestamp=i/40)\nassert ide.flush()'
  await exec(python,['-c',src],{env,cwd:dir})
  const data=await call('telemetry?folder=pendulum')
  assert.equal(data.samples.length,200);assert.equal(data.channels[0].name,'torque')
  const command=async(...args)=>(await exec(python,[cli,...args],{env,cwd:dir})).stdout
  assert.match(await command('list'),/torque\s+49\.75/)
  assert.match(await command('graph','torque'),/last 49.75/)
  await command('record','captured.csv','--seconds','0.1')
  const records=(await readFile(path.join(dir,'captured.csv'),'utf8')).trimEnd().split('\n')
  assert.equal(records.length,201)
  assert.equal(records[0],'Timestamp,Key,Value')
  assert.equal(records.at(-1),'4.975,torque,49.75')
})
