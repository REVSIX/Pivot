import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import express from 'express'
import type { AddressInfo } from 'node:net'
import { telemetryRoutes } from '../server/telemetry.ts'

test('telemetry validates whole batches and provides bounded project-local cursors', async t => {
  const app=express()
  app.use(express.json({limit:'64kb'}),telemetryRoutes())
  const server=app.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())))
  const url='http://127.0.0.1:'+(server.address() as AddressInfo).port+'/telemetry'
  const post=(samples:unknown[],folder='arm')=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({samples,folder})})
  const sample={name:'torque',unit:'N·m',t:.02,value:1.25}
  assert.equal((await post([sample,{...sample,value:null}])).status,400)
  assert.equal((await (await fetch(url+'?folder=arm')).json()).cursor,0)
  for(let i=0;i<65;i++){
    const response=await post(Array.from({length:128},(_,j)=>({...sample,t:(i*128+j)/1000})))
    assert.equal(response.status,200)
  }
  const latest=await (await fetch(url+'?folder=arm&after=8318')).json()
  assert.deepEqual(latest.samples.map((s:{seq:number})=>s.seq),[8319,8320])
  const window=await (await fetch(url+'?folder=arm')).json()
  assert.equal(window.samples.length,8192);assert.equal(window.dropped,128)
  assert.equal(window.channels.length,1);assert.equal(window.channels[0].value,1.25)
  assert.equal((await (await fetch(url+'?folder=other')).json()).samples.length,0)
})
