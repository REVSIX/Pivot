import type {Capture} from './model.ts'
import {drawView,type Camera} from './viewer.ts'
import {hue} from './ui.ts'

export type ClipFormat='mp4'|'gif'
export type MediaView={
 capture:Capture
 camera:Camera
 width:number
 height:number
 trace:boolean
 showOrigins:boolean
}

function surface(view:MediaView,maxWidth:number,maxHeight:number,readPixels=false){
 const scale=Math.min(1,maxWidth/view.width,maxHeight/view.height)
 const even=(size:number)=>Math.max(2,2*Math.floor(size*scale/2))
 const canvas=document.createElement('canvas')
 canvas.width=even(view.width);canvas.height=even(view.height)
 const context=canvas.getContext('2d',{alpha:false,willReadFrequently:readPixels})
 if(!context)throw new Error('Could not initialize the export canvas.')
 const camera={...view.camera,panX:view.camera.panX*scale,panY:view.camera.panY*scale}
 const background=hue('bg')||'#141520'
 const draw=(index:number)=>{
  context.fillStyle=background
  context.fillRect(0,0,canvas.width,canvas.height)
  drawView(context,canvas.width,canvas.height,view.capture,index,camera,view.trace,view.showOrigins)
 }
 return {canvas,context,draw}
}

export async function exportStill(view:MediaView,index:number){
 const {canvas,draw}=surface(view,1920,1080)
 draw(index)
 return new Promise<Blob>((resolve,reject)=>canvas.toBlob(
  blob=>blob?resolve(blob):reject(new Error('Could not encode the JPEG frame.')),
  'image/jpeg',.92))
}

function* samples(capture:Capture,start:number,end:number,fps:number){
 const frames=capture.frames,begin=frames[start].t,duration=frames[end].t-begin
 if(!(duration>0))throw new Error('Choose a range with two different timestamps.')
 const count=Math.max(1,Math.ceil(duration*fps)),durationPerFrame=duration/count
 let index=start
 for(let i=0;i<=count;i++){
  const time=i*durationPerFrame
  while(index<end&&(i===count||frames[index+1].t<=begin+time))index++
  yield {index,time,duration:durationPerFrame,progress:i/count}
 }
}

export async function exportClip(view:MediaView,format:ClipFormat,start:number,end:number,progress:(value:number)=>void){
 if(format==='gif'){
  const {GIFEncoder,quantize,applyPalette}=await import('gifenc')
  const {canvas,context,draw}=surface(view,540,360,true),gif=GIFEncoder()
  const format='rgb444'
  let count=0
  for(const frame of samples(view.capture,start,end,12)){
   draw(frame.index)
   const pixels=context.getImageData(0,0,canvas.width,canvas.height).data
   const palette=quantize(pixels,128,{format})
   gif.writeFrame(applyPalette(pixels,palette,format),canvas.width,canvas.height,{
    palette,delay:Math.max(20,Math.round(frame.duration*1000)),repeat:0,
   })
   if(++count%4===0){progress(frame.progress);await new Promise(resolve=>setTimeout(resolve,0))}
  }
  gif.finish()
  return new Blob([new Uint8Array(gif.bytes()).buffer],{type:'image/gif'})
 }

 const {BufferTarget,CanvasSource,Mp4OutputFormat,Output,canEncodeVideo}=await import('mediabunny')
 const {canvas,draw}=surface(view,1280,720)
 const bitrate=3_000_000
 if(!await canEncodeVideo('avc',{width:canvas.width,height:canvas.height,bitrate}))
  throw new Error('H.264 encoding is unavailable in this browser. You can still export a GIF.')
 const target=new BufferTarget()
 const output=new Output({format:new Mp4OutputFormat(),target})
 const video=new CanvasSource(canvas,{codec:'avc',bitrate})
 output.addVideoTrack(video)
 try{
  await output.start()
  for(const frame of samples(view.capture,start,end,30)){
   draw(frame.index)
   await video.add(frame.time,frame.duration)
   progress(frame.progress)
  }
  video.close()
  await output.finalize()
 }catch(error){await output.cancel().catch(()=>{});throw error}
 if(!target.buffer)throw new Error('MP4 encoding produced no video.')
 return new Blob([target.buffer],{type:'video/mp4'})
}
