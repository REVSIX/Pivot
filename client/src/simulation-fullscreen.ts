import {dialog,el,report} from './ui.ts'

function bindFullscreenGesture(canvas:HTMLCanvasElement,toggle:()=>void){
 type Tap={x:number;y:number;time:number}
 let contact:(Tap&{id:number;type:'mouse'|'touch';radius:number})|undefined
 let lastTap:Tap|undefined
 let mouseClicks=0
 const reset=()=>{contact=undefined;lastTap=undefined;mouseClicks=0}
 const near=(point:Tap,event:PointerEvent,radius=16)=>Math.hypot(point.x-event.clientX,point.y-event.clientY)<=radius
 document.addEventListener('pointerdown',event=>{
  const type=event.pointerType
  if((type!=='mouse'&&type!=='touch')||event.button!==0||!event.isPrimary||event.target!==canvas||dialog.open){reset();return}
  if(type==='mouse')lastTap=undefined
  else mouseClicks=0
  contact={id:event.pointerId,type,radius:type==='mouse'?4:16,x:event.clientX,y:event.clientY,time:event.timeStamp}
 },true)
 document.addEventListener('pointermove',event=>{
  if(contact?.id===event.pointerId&&!near(contact,event,contact.radius))reset()
 },true)
 document.addEventListener('pointerup',event=>{
  if(contact?.id!==event.pointerId)return
  const start=contact
  contact=undefined
  if(dialog.open||event.button!==0||!near(start,event,start.radius)){reset();return}
  if(start.type==='mouse'){mouseClicks++;return}
  if(event.timeStamp-start.time>250){reset();return}
  if(lastTap&&event.timeStamp-lastTap.time<=320&&near(lastTap,event)){
   reset()
   toggle()
  }else lastTap={x:event.clientX,y:event.clientY,time:event.timeStamp}
 },true)
 canvas.addEventListener('dblclick',event=>{
  // The browser supplies mouse double-click timing. Touch can also synthesize this event.
  if(event.button!==0||mouseClicks<2||dialog.open)return
  reset()
  toggle()
 })
 document.addEventListener('pointercancel',reset,true)
 document.addEventListener('fullscreenchange',reset)
 window.addEventListener('blur',reset)
}

export function installSimulationFullscreen(){
 const root=document.documentElement
 const panel=el('sim-pane'),toggle=el<HTMLButtonElement>('sim-fullscreen')
 const pressedPointers=new Set<number>()
 let timer=0
 const active=()=>document.fullscreenElement===root
 const reveal=()=>{
  if(!active())return
  panel.dataset.controls='shown'
  clearTimeout(timer)
  if(!pressedPointers.size)timer=window.setTimeout(()=>delete panel.dataset.controls,2400)
 }
 const toggleFullscreen=()=>{
  if(active())void document.exitFullscreen().catch(report)
  else void root.requestFullscreen().catch(report)
 }
 toggle.onclick=toggleFullscreen
 bindFullscreenGesture(el<HTMLCanvasElement>('scene'),toggleFullscreen)
 document.addEventListener('fullscreenchange',()=>{
  const fullscreen=active()
  root.toggleAttribute('data-sim-fullscreen',fullscreen)
  const label=fullscreen?'Exit fullscreen':'Enter fullscreen'
  toggle.title=label;toggle.setAttribute('aria-label',label)
  toggle.setAttribute('aria-pressed',String(fullscreen))
  if(fullscreen)reveal()
  else{pressedPointers.clear();clearTimeout(timer);delete panel.dataset.controls}
 })
 panel.addEventListener('pointermove',reveal)
 panel.addEventListener('pointerdown',event=>{
  if(!active())return
  pressedPointers.add(event.pointerId)
  reveal()
 })
 const releasePointer=(event:PointerEvent)=>{
  if(pressedPointers.delete(event.pointerId))reveal()
 }
 document.addEventListener('pointerup',releasePointer,true)
 document.addEventListener('pointercancel',releasePointer,true)
 window.addEventListener('blur',()=>{
  pressedPointers.clear()
  reveal()
 })
 document.addEventListener('keydown',event=>{
  if(!active()||dialog.open)return
  if(event.key==='Escape'){event.preventDefault();void document.exitFullscreen().catch(report)}
  else reveal()
 })
}
