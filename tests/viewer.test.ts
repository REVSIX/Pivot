import test from 'node:test'
import assert from 'node:assert/strict'
import {createCamera, drawView} from '../client/src/viewer.ts'
import type {Capture} from '../client/src/model.ts'

test('hiding body origins preserves native geometry and can be reversed on a cached capture',()=>{
  // Record emitted canvas paths; exercise the renderer without requiring a browser/GPU.
  let polygons:number[][][]=[]
  let current:number[][]=[]
  const context={
    beginPath(){current=[]}, moveTo(x:number,y:number){current.push([x,y])},
    lineTo(x:number,y:number){current.push([x,y])}, closePath(){},
    fill(){polygons.push(current.map(p=>p.slice()))}, stroke(){}, fillRect(){}, fillText(){},
  } as unknown as CanvasRenderingContext2D
  const originalStyle=globalThis.getComputedStyle
  const originalDocument=globalThis.document
  globalThis.document={documentElement:{}} as Document
  globalThis.getComputedStyle=(()=>({getPropertyValue(){return ''}})) as unknown as typeof getComputedStyle
  try{
    const capture={nodes:[{name:'fixed_stair',parent:-1}],joints:[],
      geoms:[{body:-1,type:'box',pos:[0,0,.2],quat:[1,0,0,0],size:[1,.5,.2]}],
      frames:[{t:0,q:[],v:[],p:[[0,0]],xyz:[[0,0,0]],quat:[[1,0,0,0]]}],
    } as unknown as Capture
    const camera=createCamera('2d')
    const render=(show:boolean)=>{polygons=[];drawView(context,800,600,capture,0,camera,false,show);return polygons}
    const hidden=render(false)
    assert.ok(hidden.length>0,'native stair geometry must still be drawn')
    const visible=render(true)
    assert.ok(visible.length>hidden.length,'origin bearings add visible polygons')
    assert.deepEqual(render(false),hidden,'toggling off must work after the capture is cached')
    assert.deepEqual(render(true),visible,'toggling on must restore the same drawing')
  }finally{
    globalThis.getComputedStyle=originalStyle
    globalThis.document=originalDocument
  }
})
