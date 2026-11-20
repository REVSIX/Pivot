import { el,pref,readPref, type Action } from './ui.ts'
export type Mode='code'|'debug'|'simulation'|'split'
const modes:Mode[]=['code','debug','simulation','split']
const app=el('workbench')
export let current:Mode='split'
let redraw=()=>{}
type Layout={side:number;left:number;code:number;sim:number;sideOff:boolean;termOff:boolean}
const defaults:Layout={side:210,left:46,code:65,sim:55,sideOff:false,termOff:false}
let saved:Layout={...defaults,...readPref<Partial<Layout>>('layout',{})}
function apply(){app.style.setProperty('--side',saved.side+'px');app.style.setProperty('--left',saved.left+'%');app.style.setProperty('--code-height',saved.code+'%');app.style.setProperty('--sim-height',saved.sim+'%');app.classList.toggle('side-off',saved.sideOff);app.classList.toggle('term-off',saved.termOff);requestAnimationFrame(redraw)}
export function setMode(mode:Mode){current=mode;delete app.dataset.max;document.querySelectorAll('.is-max').forEach(n=>n.classList.remove('is-max'));app.dataset.mode=mode;pref('mode',mode);for(const b of document.querySelectorAll<HTMLElement>('#modes [data-mode]')){if(b.dataset.mode===mode)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current')}requestAnimationFrame(redraw)}
export function sidebar(force=false){if(matchMedia('(max-width:730px)').matches){app.classList.toggle('mobile-side',force || !app.classList.contains('mobile-side'));return}saved.sideOff=force?false:!saved.sideOff;apply();pref('layout',saved)}
export function showShell(){saved.termOff=false;if(current!=='split'&&current!=='code')setMode('code');else if(app.dataset.max)setMode(current);apply();pref('layout',saved)}
function maximize(id:string){const restore=app.dataset.max===id;document.querySelectorAll('.is-max').forEach(n=>n.classList.remove('is-max'));delete app.dataset.max;if(!restore){app.dataset.max=id;el(id).classList.add('is-max')}requestAnimationFrame(redraw)}
export function focusEditorLayout(){if(app.dataset.max==='code-pane')return;if(current!=='code'&&current!=='split')setMode('code');maximize('code-pane')}
export const layoutActions:Action[]=[{label:'Toggle explorer',do:()=>sidebar()},{label:'Toggle integrated terminal',do:()=>{saved.termOff=!saved.termOff;apply();pref('layout',saved)}},{label:'Restore default layout',do:()=>{saved={...defaults};setMode('split');apply();pref('layout',saved)}}]
export const modeActions:Action[]=modes.map((m,i)=>({label:'Workspace • '+m,key:'Ctrl+'+(i+1),do:()=>setMode(m)}))
export function initializeLayout(onResize:()=>void){
 redraw=onResize;apply();setMode(modes.includes(readPref('mode','split'))?readPref('mode','split'):'split')
 for(const b of document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]'))b.onclick=()=>setMode(b.dataset.mode as Mode)
 for(const b of document.querySelectorAll<HTMLButtonElement>('[data-max]')){if(!b.dataset.max)continue;b.title='Maximize or restore panel';b.setAttribute('aria-label',b.title);b.onclick=()=>maximize(b.dataset.max!)}
 for(const head of document.querySelectorAll<HTMLElement>('.panel-head'))head.ondblclick=e=>{if(!(e.target as HTMLElement).closest('button'))maximize(head.parentElement!.id)}
 for(const [grip,key,parent,axis,min,max] of [
 ['side-resize','side','workspace','x',138,420],['main-resize','left','panels','x',25,74],['left-resize','code','left-stack','y',22,84],['right-resize','sim','right-stack','y',25,84]
 ] as const){const handle=el(grip);handle.tabIndex=0;handle.setAttribute('aria-orientation',axis==='x'?'vertical':'horizontal')
 const set=(v:number)=>{saved[key]=Math.max(min,Math.min(max,v));apply()}
 handle.onpointerdown=e=>{e.preventDefault();handle.setPointerCapture(e.pointerId);const initial=saved[key],coord=axis==='x'?e.clientX:e.clientY
 const bounds=el(parent).getBoundingClientRect(),factor=key==='side'?1:100/(axis==='x'?bounds.width:bounds.height)
 handle.onpointermove=ev=>set(initial+((axis==='x'?ev.clientX:ev.clientY)-coord)*factor)
 handle.onlostpointercapture=()=>{handle.onpointermove=null;pref('layout',saved)}}
 handle.onkeydown=e=>{if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].includes(e.key)){e.preventDefault();set(saved[key]+(['ArrowLeft','ArrowUp'].includes(e.key)?-1:1)*(key==='side'?10:2));pref('layout',saved)}}}
}
