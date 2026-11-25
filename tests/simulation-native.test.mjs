import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp,readFile,rm,writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import express from 'express'
import { base,pythonPath } from '../scripts/runtime.mjs'
import { liveSimulationRoutes } from '../server/live-simulation.ts'
import { telemetryEnv,telemetryRoutes } from '../server/telemetry.ts'
import { createWorkbench } from '../server/app.ts'
import { WebSocket } from 'ws'

const exec=promisify(execFile)
test('Run in Embedded Viewer streams an unchanged passive-viewer script and its sensors', {timeout:20000},async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'pivot-embedded-'))
  await writeFile(path.join(root,'passive demo.py'),`
import sys
from pathlib import Path
import mujoco
import mujoco.viewer

assert sys.argv[1:] == ["--label", "two words"]
assert Path(__file__).parent.resolve() == Path.cwd().resolve()
model = mujoco.MjModel.from_xml_string("""
<mujoco>
 <worldbody><body><joint name="hinge"/><geom size=".1" pos=".12 0 0" mass=".1"/></body></worldbody>
 <actuator><motor name="drive" joint="hinge"/></actuator>
 <sensor><jointpos name="angle" joint="hinge"/></sensor>
</mujoco>
""")
data = mujoco.MjData(model)
with mujoco.viewer.launch_passive(model, data) as viewer:
    with viewer.lock():
        viewer.opt.flags[mujoco.mjtVisFlag.mjVIS_CONTACTPOINT] = 1
    data.ctrl[0] = .1
    for _ in range(10):
        assert viewer.is_running()
        mujoco.mj_step(model, data)
        viewer.sync()
print("Passive viewer script completed")
`)
  const wb=await createWorkbench({root})
  wb.server.listen(0,'127.0.0.1')
  await once(wb.server,'listening')
  t.after(async()=>{await wb.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100})})
  const origin='http://127.0.0.1:'+wb.server.address().port
  const {token}=await (await fetch(origin+'/api/session')).json()
  const run=randomUUID()
  const query=new URLSearchParams({folder:'.',runFile:'passive demo.py',embedded:run,args:JSON.stringify(['--label','two words'])})
  const ws=new WebSocket(origin.replace('http:','ws:')+'/terminal?'+query,'pivot.'+token,{origin})
  t.after(()=>ws.terminate())
  let output=''
  ws.on('message',(data,binary)=>{if(!binary)output+=data.toString()})
  const [code,reason]=await once(ws,'close')
  assert.equal(code,1000,reason.toString()+'\n'+output)
  const get=async suffix=>(await fetch(origin+'/api/'+suffix,{headers:{'X-Pivot-Token':token}})).json()
  const recording=await get('sim/active?folder=.&run='+run)
  assert.equal(recording.state,'closed')
  assert.equal(recording.capture.control,'passive')
  assert.equal(recording.capture.source.script,'passive demo.py')
  assert.ok(recording.capture.frames.at(-1).t>0)
  assert.ok(recording.capture.frames.at(-1).q[0]>0)
  const {channels}=await get('telemetry?folder=.')
  for(const name of ['MuJoCo/joint/hinge/position','MuJoCo/joint/hinge/velocity','MuJoCo/actuator/drive/control','MuJoCo/actuator/drive/force','MuJoCo/sensor/angle'])
    assert.ok(channels.some(channel=>channel.name===name),name)
})
async function service(t,root=path.join(base,'examples')) {
  const token='native-test-token',app=express(),live=liveSimulationRoutes(root,()=>host,token)
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
test('model preview reads the initial pose without executing a project controller',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'pivot-preview-test-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await writeFile(path.join(root,'terrain.xml'),'<mujoco><worldbody><geom type="box" size="1 1 .1"/></worldbody></mujoco>')
  await writeFile(path.join(root,'train.py'),'# --pivot-live\nraise RuntimeError("controller executed")\n')
  const {call}=await service(t,root)
  const preview=await call('sim/preview',{folder:'.',file:'terrain.xml'})
  assert.equal(preview.frames.length,1)
  assert.equal(preview.frames[0].t,0)
  assert.equal(preview.joints.length,0)
  assert.equal(preview.geoms.length,1)
  await assert.rejects(call('sim/open',{folder:'.',file:'terrain.xml'}),/controller executed/)
})
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
