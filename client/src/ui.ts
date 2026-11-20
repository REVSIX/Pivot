import { icon } from './icons.ts'
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T
export function node<K extends keyof HTMLElementTagNameMap>(tag:K,text='',cls=''){const out=document.createElement(tag);out.className=cls;out.textContent=text;return out}
export function glyph(name:string,cls=''){const i=node('i','',cls);i.innerHTML=icon(name);return i}
export function run(fn:()=>unknown){try{Promise.resolve(fn()).catch(report)}catch(e){report(e)}}
export function button(text:string,fn:()=>unknown,cls='choice'){const b=node('button',text,cls);b.type='button';b.onclick=()=>run(fn);return b}
let statusTimer=0
export function message(text:string){el('toast').textContent=text;clearTimeout(statusTimer);statusTimer=window.setTimeout(()=>el('toast').textContent='',6500)}
export function report(e:unknown){message(e instanceof Error?e.message:String(e))}
export let token=''
export function setToken(v:string){token=v}
export async function api<T>(endpoint:string,data?:object,signal?:AbortSignal):Promise<T>{
 const response=await fetch('/api/'+endpoint,{method:data?'POST':'GET',headers:{'X-Pivot-Token':token,...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal})
 if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Request failed ('+response.status+')')
 return response.json()
}
export function query(endpoint:string,params:Record<string,string>){return endpoint+'?'+new URLSearchParams(params)}
export const dialog=el<HTMLDialogElement>('dialog'), content=el('dialog-content')
let clearPreview=()=>{}
export function modal(title:string){clearPreview();content.replaceChildren();el('dialog-title').textContent=title;if(!dialog.open)dialog.showModal()}
export function close(){clearPreview();if(dialog.open)dialog.close()}
dialog.addEventListener('cancel',event=>{event.preventDefault();close()})
export interface Action{label:string;do:()=>unknown;key?:string;preview?:()=>void}
export function fuzzy(value:string,needle:string){
 const a=value.toLowerCase(),b=needle.trim().toLowerCase();let prev=-1,score=0
 for(const ch of b){if(ch===' ')continue;const i=a.indexOf(ch,prev+1);if(i<0)return -1;score+=i===prev+1?5:1;if(i===0 || a[i-1]===' ')score+=3;prev=i}
 return score
}
interface ChoiceOptions{
 score?:(action:Action,query:string)=>number
 resetPreview?:()=>void
 previewOnFilter?:boolean
}
export function choices(title:string,actions:Action[],placeholder='Filter…',options:ChoiceOptions={}){
 modal(title);const search=node('input','','query choice-query');search.placeholder=placeholder;search.setAttribute('aria-label',title+' filter')
 const list=node('div');let selected=0, shown:Action[]=[], previewed:Action|undefined
 const score=options.score||((action:Action,query:string)=>fuzzy(action.label,query))
 const clear=()=>{if(previewed){previewed=undefined;options.resetPreview?.()}}
 clearPreview=()=>{clearPreview=()=>{};clear()}
 function execute(a:Action){close();run(a.do)}
 function highlight(index:number,scroll=true,preview=true){
  list.children[selected]?.classList.remove('selected')
  selected=index
  const row=list.children[selected]
  row?.classList.add('selected')
  if(scroll&&selected)row?.scrollIntoView({block:'nearest'})
  if(!selected&&scroll)content.scrollTop=0
  if(!preview){clear();return}
  const action=shown[selected]
  if(action===previewed)return
  if(action?.preview){previewed=action;action.preview()}
  else clear()
 }
 function draw(keep?:Action){
  list.replaceChildren()
  shown=actions.map(a=>({a,score:score(a,search.value)})).filter(m=>m.score>=0).sort((a,b)=>b.score-a.score).map(m=>m.a)
  shown.forEach((a,i)=>{
   const b=button(a.label,()=>execute(a))
   if(a.key)b.append(node('small',a.key))
   if(a.preview)b.dataset.preview=''
   if(options.resetPreview){
    b.onpointermove=event=>{if(event.pointerType==='mouse'&&(selected!==i||a.preview&&previewed!==a))highlight(i,false)}
    b.onfocus=()=>highlight(i,false)
   }
   list.append(b)
  })
  if(shown.length)highlight(keep?Math.max(0,shown.findIndex(a=>a.label===keep.label&&a.key===keep.key)):0,true,options.previewOnFilter!==false)
  else{list.append(node('p','No matches.','hint'));clear();content.scrollTop=0}
 }
 search.oninput=()=>draw()
 search.onkeydown=e=>{if(!shown.length)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();highlight((selected+shown.length+(e.key==='ArrowDown'?1:-1))%shown.length)}if(e.key==='Enter'){e.preventDefault();execute(shown[selected])}}
 content.append(search,list);draw();search.focus()
 return (next:Action[])=>{if(dialog.open&&search.isConnected){actions=next;draw(shown[selected])}}
}
export function promptText(title:string,label:string,initial:string,submit:(value:string)=>Promise<unknown>|unknown){
 modal(title);const form=node('form'),input=node('input','','query');input.placeholder=label;input.setAttribute('aria-label',label);input.value=initial
 const error=node('p','','hint'),ok=node('button','Continue','plain-action');form.append(node('p',label,'hint'),input,error,ok);content.append(form)
 form.onsubmit=async e=>{e.preventDefault();const value=input.value.trim();if(!value)return;ok.disabled=true;try{close();await submit(value)}catch(e){report(e)}finally{ok.disabled=false}}
 input.focus();input.select()
}
export function confirmAction(title:string,explanation:string,label:string,yes:()=>unknown){
 modal(title);content.append(node('p',explanation,'hint'),button(label,()=>{close();run(yes)},'plain-action'),button('Cancel',close,'plain-action'))
}
export function download(data:string|Blob,name:string){const url=URL.createObjectURL(typeof data==='string'?new Blob([data],{type:'text/csv;charset=utf-8'}):data);const a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1200)}
export function readPref<T>(key:string,fallback:T):T{try{const v=localStorage.getItem('pivot.'+key);return v?JSON.parse(v):fallback}catch{return fallback}}
export function pref(key:string,value:unknown){localStorage.setItem('pivot.'+key,JSON.stringify(value))}
export function bridge(command:string){const w=window as Window & {chrome?:{webview?:{postMessage:(action:string)=>void}}};if(!w.chrome?.webview)return false;w.chrome.webview.postMessage(command);return true}
export const native=!!(window as Window & {chrome?:{webview?:unknown}}).chrome?.webview
export function hue(name:string){return getComputedStyle(document.documentElement).getPropertyValue('--'+name).trim()}
