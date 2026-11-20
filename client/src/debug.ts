import { api,button,content,el,hue,modal,node,pref,query,readPref,download,message,token } from './ui.ts'
import type {Capture,Frame} from './model.ts'
import {graph,tint} from './plot.ts'
type Point={seq:number;name:string;t:number;value:number;unit:string}
type Channel={id:string;name:string;unit:string;i:number;field:'q'|'v'|'sdk'}
export class DebugView{
 private scope='';private seq=0;private history:Point[]=[];private sdk=new Map<string,Point>();private frozen=false
 private selection=new Set<string>();private explicit=false;private tab='traces';private signature?:string;private logs:{t:string;msg:string}[]=[]
 private interval=0;private pending=false;private filter='';private inputTab='';capture?:Capture;index=0
 private generation=0;private clearing=false
 private source?:Capture;private sourceIndex=0;private clearedThrough?:Frame;private frameOffset=0
 constructor(readonly seek:(index:number)=>void){for(const b of document.querySelectorAll<HTMLButtonElement>('[data-debug]'))b.onclick=()=>{this.tab=b.dataset.debug!;this.filter='';this.inputTab='';this.signature=undefined;this.paint()};el('channels-button').onclick=()=>this.channelsDialog()}
 setProject(folder:string){this.generation++;this.clearing=false;this.scope=folder;this.seq=0;this.history=[];this.sdk.clear();this.logs=[];this.frozen=false;this.source=undefined;this.sourceIndex=0;this.clearedThrough=undefined;this.frameOffset=0;this.capture=undefined;this.index=0;this.signature=undefined;const selected=readPref<string[]|null>('channels.'+folder,null);this.explicit=selected!==null;this.selection=new Set(selected||[]);clearInterval(this.interval);this.interval=window.setInterval(()=>void this.poll(),500);this.log('Workspace opened');void this.poll()}
 async poll(){if(this.pending||this.clearing||this.frozen||document.hidden||!this.scope)return;this.pending=true;const scope=this.scope,generation=this.generation
 try{const d=await api<{samples:Point[];channels:Point[];cursor:number;dropped:number}>(query('telemetry',{folder:scope,after:String(this.seq)}));if(generation!==this.generation)return
 if(d.samples.length||d.cursor!==this.seq){if(d.cursor<this.seq){this.history=[];this.sdk.clear()}this.seq=d.cursor;this.history=this.history.concat(d.samples).slice(-4096);for(const p of d.channels)this.sdk.set(p.name,p)
 if(d.dropped)this.log(d.dropped+' SDK samples fell outside the retained window');this.paint()}}
 catch(e){if(generation===this.generation&&!this.logs.some(x=>x.msg.includes('SDK unavailable')))this.log('SDK unavailable · '+String(e))}finally{this.pending=false}}
 log(msg:string){this.logs.push({t:new Date().toLocaleTimeString('en-GB'),msg});if(this.logs.length>160)this.logs.shift();if(this.tab==='logs')this.paint()}
 async export(format:'csv'|'mcap'){
  if(!this.scope)return
  const url='/api/'+query('telemetry/export/'+format,{folder:this.scope})
  const response=await fetch(url,{headers:{'X-Pivot-Token':token}})
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Export failed.')
  download(await response.blob(),'pivot-telemetry.'+format)
  message('Exported '+response.headers.get('X-Pivot-Samples')+' telemetry samples.')
 }
 async clear(){
  if(!this.scope||this.clearing)return
  this.clearing=true
  const generation=++this.generation
  try{
   await api('telemetry/clear',{folder:this.scope})
   if(generation!==this.generation)return
   this.seq=0;this.history=[];this.sdk.clear();this.signature=undefined
   this.clearedThrough=this.source?.frames.at(-1)
   this.update(this.source,this.sourceIndex)
   message('Telemetry cleared.')
  }finally{if(generation===this.generation)this.clearing=false}
 }
 series():Channel[]{const result:Channel[]=[];this.capture?.joints.forEach((j,i)=>{result.push({id:'q:'+i,name:j.name+' / position',unit:j.unit,i,field:'q'},{id:'v:'+i,name:j.name+' / velocity',unit:j.unit+'/s',i,field:'v'})});for(const [i,p] of [...this.sdk.values()].entries())result.push({id:'sdk:'+p.name,name:p.name,unit:p.unit,field:'sdk',i});return result}
 update(run:Capture|undefined,index:number){
  if(run!==this.source)this.clearedThrough=undefined
  this.source=run;this.sourceIndex=index
  this.frameOffset=run&&this.clearedThrough?run.frames.indexOf(this.clearedThrough)+1:0
  if(!this.frameOffset)this.clearedThrough=undefined
  this.capture=run&&this.frameOffset<run.frames.length
   ?(this.frameOffset?{...run,frames:run.frames.slice(this.frameOffset)}:run):undefined
  this.index=Math.max(0,index-this.frameOffset)
  this.paint()
 }
 active(c:Channel){return this.explicit?this.selection.has(c.id):c.field!=='sdk'||!this.capture}
 change(c:Channel){if(!this.explicit){this.selection=new Set(this.series().filter(x=>this.active(x)).map(x=>x.id));this.explicit=true}if(this.selection.has(c.id))this.selection.delete(c.id);else this.selection.add(c.id);pref('channels.'+this.scope,[...this.selection]);this.signature=undefined;this.paint()}
 value(c:Channel){return c.field==='sdk'?this.sdk.get(c.name)?.value:this.capture?.frames[this.index]?.[c.field][c.i]}
 channelsDialog(){modal('Telemetry channels');for(const c of this.series()){const input=node('input');input.type='checkbox';input.checked=this.active(c);input.onchange=()=>this.change(c);const row=node('label','','variable-row');row.append(input,node('span',c.name));content.append(row)}
 content.append(button(this.frozen?'Resume SDK stream':'Freeze SDK stream',()=>{this.frozen=!this.frozen;this.channelsDialog()}))}
 paint(){const host=el('debug-content');for(const b of document.querySelectorAll<HTMLButtonElement>('[data-debug]'))b.setAttribute('aria-pressed',String(b.dataset.debug===this.tab))
 if(!host.clientWidth)return
 if(this.tab!=='traces'){if(this.inputTab!==this.tab){host.replaceChildren();const search=node('input','','search-line');search.placeholder='Filter '+this.tab+'…';search.setAttribute('aria-label','Filter '+this.tab);search.value=this.filter;search.oninput=()=>{this.filter=search.value;this.paint()};host.append(search,node('div','','records'));this.inputTab=this.tab}const rows=host.querySelector('.records')!;rows.replaceChildren()
 if(this.tab==='logs'){for(const l of [...this.logs].reverse().filter(l=>l.msg.toLowerCase().includes(this.filter.toLowerCase()))){const row=node('div','','log-row');row.append(node('time',l.t),l.msg);rows.append(row)}}else{for(const c of this.series().filter(c=>c.name.toLowerCase().includes(this.filter.toLowerCase()))){const row=node('label','','variable-row'),check=node('input');check.type='checkbox';check.checked=this.active(c);check.onchange=()=>this.change(c);row.append(check,c.name,node('output',(this.value(c)?.toFixed(3)??'—')+' '+c.unit));rows.append(row)}}return}
 this.inputTab='';const channels=this.series().filter(c=>this.active(c));const sig=channels.map(c=>c.id).join('|')
 if(sig!==this.signature||!host.querySelector('.axis')){this.signature=sig;host.replaceChildren()
 if(!channels.length)host.append(node('p','Select channels or run a model to plot telemetry.','empty'))
 for(const c of channels){const row=node('div','','trace-row'),head=node('div','','trace-head'),swatch=node('i','','swatch');swatch.style.background=tint(c.i);head.append(swatch,c.name,node('output'))
 const canvas=node('canvas');canvas.setAttribute('aria-label',c.name+' graph');canvas.onclick=e=>{if(c.field!=='sdk'&&this.capture)this.seek(this.frameOffset+Math.round((this.capture.frames.length-1)*e.offsetX/canvas.clientWidth))};row.append(head,canvas);host.append(row)}host.append(node('div','','axis'))}
 const rows=host.querySelectorAll<HTMLElement>('.trace-row');channels.forEach((c,i)=>{const row=rows[i];row.querySelector('output')!.textContent=(this.value(c)?.toFixed(3)??'—')+' '+c.unit;const canvas=row.querySelector('canvas')!;if(c.field==='sdk')this.sdkGraph(canvas,c);else if(this.capture)graph(canvas,this.capture,c.i,this.index,true,c.field==='v')})
 const f=this.capture?.frames;const axis=host.querySelector('.axis')!;axis.replaceChildren(node('span',(f?.[0]?.t??this.history[0]?.t??0).toFixed(3)+' s'),node('span',(f?.at(-1)?.t??this.history.at(-1)?.t??0).toFixed(3)+' s'))
 }
 private sdkGraph(canvas:HTMLCanvasElement,c:Channel){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;const ratio=Math.min(devicePixelRatio,2);if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio)}const g=canvas.getContext('2d')!;g.setTransform(ratio,0,0,ratio,0,0);g.clearRect(0,0,w,h);const list=this.history.filter(p=>p.name===c.name);if(!list.length)return;const t=list.map(p=>p.t),v=list.map(p=>p.value);const min=Math.min(...v),max=Math.max(...v),t0=Math.min(...t),t1=Math.max(...t);g.strokeStyle=hue('grid');g.beginPath();g.moveTo(0,h/2);g.lineTo(w,h/2);g.stroke();g.strokeStyle=tint(c.i);g.lineWidth=1.6;g.beginPath();list.forEach((p,i)=>{const x=(p.t-t0)/(t1-t0||1)*w,y=h-3-(p.value-min)/(max-min||1)*(h-6);if(i)g.lineTo(x,y);else g.moveTo(x,y)});g.stroke()}
}
