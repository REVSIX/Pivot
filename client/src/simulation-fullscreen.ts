import {dialog,el,report} from './ui.ts'

export function installSimulationFullscreen(){
 const root=document.documentElement
 const panel=el('sim-pane'),toggle=el<HTMLButtonElement>('sim-fullscreen')
 let timer=0
 const active=()=>document.fullscreenElement===root
 const reveal=()=>{
  if(!active())return
  panel.dataset.controls='shown'
  clearTimeout(timer)
  timer=window.setTimeout(()=>delete panel.dataset.controls,2400)
 }
 toggle.onclick=()=>{
  if(active())void document.exitFullscreen().catch(report)
  else void root.requestFullscreen().catch(report)
 }
 document.addEventListener('fullscreenchange',()=>{
  const fullscreen=active()
  root.toggleAttribute('data-sim-fullscreen',fullscreen)
  const label=fullscreen?'Exit fullscreen':'Enter fullscreen'
  toggle.title=label;toggle.setAttribute('aria-label',label)
  toggle.setAttribute('aria-pressed',String(fullscreen))
  if(fullscreen)reveal()
  else{clearTimeout(timer);delete panel.dataset.controls}
 })
 panel.addEventListener('pointermove',reveal)
 panel.addEventListener('pointerdown',reveal)
 document.addEventListener('keydown',event=>{
  if(!active()||dialog.open)return
  if(event.key==='Escape'){event.preventDefault();void document.exitFullscreen().catch(report)}
  else reveal()
 })
}
