import assert from 'node:assert/strict'
import test from 'node:test'
import {clipCapture,mediaFilename,type Capture} from '../client/src/model.ts'

const recording:Capture={
 title:'Elevator',engine:'MuJoCo',dt:.02,integrator:'Euler',nodes:[],joints:[],
 source:{script:'src/train_elevator.py',model:'models/elevator.xml'},
 frames:[.64,.68,.68,0,.04,.36].map(t=>({t,q:[],v:[],p:[]})),
}

test('clip timestamps stay ordered across paused frames and episode resets',()=>{
 const clip=clipCapture(recording)
 assert.deepEqual(clip.frames.map(f=>+f.t.toFixed(3)),[.64,.68,.72,.76,.8,1.12])
 assert.deepEqual(recording.frames.map(f=>f.t),[.64,.68,.68,0,.04,.36])
})

test('media filenames use the captured controller before the captured model',()=>{
 assert.equal(mediaFilename(recording,'stale.xml','gif'),'train_elevator.gif')
 assert.equal(mediaFilename({...recording,source:{model:'C:\\models\\elevator.mjcf'}},'stale.xml','mp4'),'elevator.mp4')
 assert.equal(mediaFilename({...recording,source:undefined},'builtins/cart-pole.xml','jpg'),'cart-pole.jpg')
})
