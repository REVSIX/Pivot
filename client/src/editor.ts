import {Terminal} from '@xterm/xterm'
import {FitAddon} from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {hue,message} from './ui.ts'
import type {Palette} from '../../shared/theme.ts'
export type Session={focus:()=>void;open:(path:string)=>void;theme:(palette?:Palette)=>void;close:()=>void;runFile:()=>Promise<string>;interrupt:()=>void;moved:(from:string,to:string)=>void}
export function launch(host:HTMLElement,token:string,folder:string,kind:'editor'|'terminal',options:{file?:string;profile?:string;shell?:string;task?:string;runFile?:string},onExit:(message:string)=>void,onReady:()=>void):Session{
 const colors=()=>({background:hue('panel'),foreground:hue('text'),cursor:hue('accent'),selectionBackground:hue('sel'),black:hue('bg'),brightBlack:hue('muted'),yellow:hue('accent'),magenta:hue('trace-a'),cyan:hue('trace-b'),green:hue('green')})
 const term=new Terminal({fontFamily:'"JetBrainsMono Nerd Font Mono", "CaskaydiaCove Nerd Font Mono", "IBM Plex Mono", Consolas, monospace',fontSize:12,lineHeight:1.12,scrollback:kind==='terminal'?2000:400,theme:colors()})
 const fit=new FitAddon();term.loadAddon(fit);term.open(host)
 function size(){if(host.clientWidth>12&&host.clientHeight>12){fit.fit();if(ready)send({type:'resize',cols:term.cols,rows:term.rows})}}
 const params=new URLSearchParams({folder});for(const [key,v] of Object.entries(options))if(v)params.set(key,v)
 const ws=new WebSocket('ws://'+location.host+'/'+kind+'?'+params,'pivot.'+token);ws.binaryType='arraybuffer'
 let ready=false, pendingFile=options.file,closed=false
 let fileRequest:((result:{file?:string;error?:string})=>void)|undefined
 let pendingInterrupt=false
 const pendingMoves:{type:'moved';from:string;to:string}[]=[]
 const send=(data:object)=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data))}
 const observer=new ResizeObserver(size);observer.observe(host)
 term.attachCustomKeyEventHandler(event=>{
  if(event.ctrlKey&&(event.shiftKey&&event.code==='KeyP'||/^Digit[1-4]$/.test(event.code)))return false
  if(event.ctrlKey&&event.shiftKey&&event.code==='KeyC'&&term.hasSelection()){if(event.type==='keydown')void navigator.clipboard.writeText(term.getSelection());return false}
  return true
 })
 term.onData(data=>{if(ready)send({type:'input',data})})
 ws.onmessage=e=>{if(typeof e.data==='string'){term.write(e.data);return}
 const ctrl=new TextDecoder().decode(e.data)
 if(ctrl==='ready'){
  ready=true;size();pendingMoves.splice(0).forEach(send)
  if(pendingFile&&pendingFile!==options.file)send({type:'open',file:pendingFile})
  onReady()
  if(fileRequest)send({type:'run-file'})
  if(pendingInterrupt)send({type:'input',data:'\x03'})
 }else{try{const msg=JSON.parse(ctrl);if(msg.runResult)fileRequest?.(msg.runResult);if(msg.notice){if(kind==='editor')message(msg.notice);else term.writeln('\r\n'+msg.notice)}}catch{}}
 }
 ws.onclose=e=>{
  ready=false;observer.disconnect();fileRequest?.({error:'Editor disconnected.'})
  if(!closed){if(kind==='editor')term.dispose();onExit(e.reason||'Session ended.')}
 }
 return {
  focus:()=>term.focus(),
  theme:palette=>{term.options.theme=colors();size();if(ready&&kind==='editor'&&palette)send({type:'theme',palette})},
  open:file=>{pendingFile=file;if(ready)send({type:'open',file});term.focus()},
  close:()=>{closed=true;observer.disconnect();term.dispose();ws.close()},
  runFile:()=>new Promise((resolve,reject)=>{
   if(fileRequest){reject(new Error('Already reading the active file.'));return}
   const timeout=window.setTimeout(()=>fileRequest?.({error:'Timed out reading the active file.'}),10000)
   fileRequest=result=>{
    clearTimeout(timeout);fileRequest=undefined
    if(result.file)resolve(result.file);else reject(new Error(result.error||'Could not read the active file.'))
   }
   if(ready)send({type:'run-file'})
  }),
  interrupt:()=>{if(ready)send({type:'input',data:'\x03'});else pendingInterrupt=true},
  moved:(from,to)=>{
   const update={type:'moved' as const,from,to}
   if(ready){send(update);return}
   pendingMoves.push(update)
   if(pendingFile&&(pendingFile===from||pendingFile.startsWith(from+'/')))pendingFile=to+pendingFile.slice(from.length)
  },
 }
}
