import {csv,type Capture,type Frame,type Project} from './model.ts'
import {bindCamera,createCamera,scene,tint} from './plot.ts'
import {DebugView} from './debug.ts'
import {api,choices,download,el,message,node,pref,readPref,report,run,type Action} from './ui.ts'
import {icon} from './icons.ts'
import {builtInModel,builtInModels} from '../../shared/models.ts'
interface Update {offset:number;frames:Frame[];cursor:number;state:string;speed:number;error?:string}
export class Instrument{
 project?:Project;file='';capture?:Capture;index=0;liveId='';cursor=-1;offset=0;state='Reference';camera=createCamera(readPref('projection','3d'));trace=readPref('trajectory',false)
 debug=new DebugView(i=>run(()=>this.seek(i)));private generation=0;private timer=0;private replayTimer=0;private replaying=false;private polling=false;private locked=false;private following=true;private external=false
 constructor(){bindCamera(el<HTMLCanvasElement>('scene'),this.camera,()=>this.paint());new ResizeObserver(()=>this.paint()).observe(el('scene'))
 for(const b of document.querySelectorAll<HTMLButtonElement>('[data-projection]'))b.onclick=()=>{this.camera.mode=b.dataset.projection as '2d'|'3d';pref('projection',this.camera.mode);this.paint()}
 el('pick-model').onclick=()=>this.models()
 el('select-model').onclick=()=>this.models()
 el('center-camera').onclick=()=>{Object.assign(this.camera,createCamera(this.camera.mode));this.paint()}
 el('sim-menu').onclick=()=>choices('Simulation',[{label:'Toggle trajectory',do:()=>{this.trace=!this.trace;pref('trajectory',this.trace);this.paint()}},{label:'Export CSV',do:()=>this.exportCsv()}])
 el('play').onclick=()=>run(()=>this.transport())
 el('sim-reset').onclick=()=>run(()=>this.act('reset'))
 el('step').onclick=()=>run(()=>this.seek(this.index+1));el('back').onclick=()=>run(()=>this.seek(this.index-1));el('rewind').onclick=()=>run(()=>this.seek(0))
 el('latest').onclick=()=>{this.stopReplay();this.following=true;this.index=Math.max(0,(this.capture?.frames.length||1)-1);this.paint()}
 el<HTMLSelectElement>('speed').onchange=()=>run(()=>this.act('speed'))
 el<HTMLInputElement>('timeline').oninput=e=>run(()=>this.seek(+(e.target as HTMLInputElement).value));el('export').onclick=()=>this.exportCsv();el('export-mcap').onclick=()=>run(()=>this.debug.export('mcap'));el('clear-telemetry').onclick=()=>run(()=>this.debug.clear())
 window.addEventListener('pagehide',()=>{if(this.liveId)void fetch('/api/sim/'+this.liveId+'/action',{method:'POST',keepalive:true,headers:{'Content-Type':'application/json','X-Pivot-Token':this.sessionToken},body:'{"action":"close"}'}).catch(()=>{})})
 window.setInterval(()=>void this.attachExternal(),500)
 }
 sessionToken=''
 async setProject(p:Project){await this.release();this.project=p;this.file=readPref('model.'+p.folder,p.demo?'pendulum.xml':'');this.debug.setProject(p.folder);this.capture=undefined;this.index=0;this.state='Ready'
 if(this.file&&!builtInModel(this.file)&&!p.files.includes(this.file)){try{await api('file?'+new URLSearchParams({folder:p.folder,path:this.file}))}catch{this.file=''}}
 if(p.demo&&this.file==='pendulum.xml'){const result=await fetch('/pendulum.capture.json');if(result.ok){this.capture=await result.json();this.state='Reference'}}this.info();this.paint()}
 async release(){this.generation++;clearInterval(this.timer);this.stopReplay();const id=this.liveId;this.liveId='';this.cursor=-1;this.offset=0;this.following=true;this.external=false;if(id)await api('sim/'+id+'/action',{action:'close'}).catch(()=>{})}
 private async attachExternal(){
  if(!this.project||!this.sessionToken||this.liveId||this.locked)return
  const generation=this.generation
  try{
   const data=await api<{id?:string;capture?:Capture;cursor:number;offset:number;state:string}>('sim/active?folder='+encodeURIComponent(this.project.folder))
   if(!data.id||!data.capture||this.liveId||this.locked||generation!==this.generation)return
   this.stopReplay();this.external=true;this.liveId=data.id;this.capture=data.capture;this.cursor=data.cursor;this.offset=data.offset;this.index=Math.max(0,data.capture.frames.length-1);this.following=true;this.state=data.state==='paused'?'Paused':'Running';this.info();this.paint();this.pollLoop()
  }catch{}
 }
 private stopReplay(){clearInterval(this.replayTimer);this.replaying=false}
 private transport(){
  if(this.replaying){this.stopReplay();this.paint();return}
  if(this.state==='Running')return this.act('pause')
  if(this.capture&&!this.following&&this.index<this.capture.frames.length-1){this.replay();return}
  if(this.capture&&this.state==='Reference'){this.index=0;this.replay();return}
  return this.act('play')
 }
 private replay(){
  this.stopReplay();this.following=false;this.replaying=true;this.paint()
  let last=performance.now()
  this.replayTimer=window.setInterval(()=>{
   const frames=this.capture?.frames,next=frames?.[this.index+1]
   if(!frames||!next){this.stopReplay();this.paint();return}
   const delay=Math.max(10,(next.t-frames[this.index].t)*1000/Number(el<HTMLSelectElement>('speed').value))
   const now=performance.now()
   if(now-last>=delay){last=now;this.index++;this.paint()}
  },10)
 }
 modelMoved(from:string,to:string){
  if(!this.project||this.file!==from&&!this.file.startsWith(from+'/'))return
  this.file=to+this.file.slice(from.length);pref('model.'+this.project.folder,this.file);this.info();this.paint()
 }
 async model(file:string){if(!this.project)return;await this.release();this.file=file;pref('model.'+this.project.folder,file);this.capture=undefined;this.index=0;this.state='Ready';this.info();this.paint();message('Selected '+(builtInModel(file)?.label||file))}
 runModel(){
  if(!this.file&&!this.liveId){this.models(true);return}
  return this.act('play')
 }
 models(start=false){
  const project=this.project
  if(!project)return
  const select=async(file:string)=>{
   if(this.project!==project)return
   await this.model(file)
   if(start)await this.act('play')
  }
  const entries=(files:string[]):Action[]=>[
   ...files.filter(path=>/\.xml$/i.test(path)).map(path=>({label:path,key:this.file===path?'Selected':'Project',do:()=>select(path)})),
   ...Object.entries(builtInModels).map(([id,model])=>({label:model.label,key:this.file===id?'Selected':'Built-in',do:()=>select(id)})),
  ]
  const refresh=choices('Select MJCF model',entries(project.files),'Filter project and built-in models…')
  run(async()=>{
   const pending=['.'],files:string[]=[]
   let scanned=0
   while(pending.length&&scanned++<128&&this.project===project){
    const {entries:listed}=await api<{entries:{kind:string;path:string}[]}>('tree?'+new URLSearchParams({folder:project.folder,path:pending.shift()!}))
    for(const entry of listed){
     if(entry.kind==='directory')pending.push(entry.path)
     else if(/\.xml$/i.test(entry.path))files.push(entry.path)
    }
   }
   if(this.project===project)refresh(entries(files))
  })
 }
 async act(action:string){if(this.locked)return;if(action==='speed'&&!this.liveId)return;if(!this.project||(!this.file&&!this.liveId)){message('Select an MJCF model first.');return}
 this.locked=true;this.paintTransport();const gen=this.generation
 try{
 if(!this.liveId){if(action==='pause')return
 const opened=await api<{id:string;capture:Capture;cursor:number;offset:number;state:string}>('sim/open',{folder:this.project.folder,file:this.file});if(this.generation!==gen){await api('sim/'+opened.id+'/action',{action:'close'}).catch(()=>{});return}
 this.liveId=opened.id;this.capture=opened.capture;this.cursor=opened.cursor;this.offset=opened.offset;this.index=this.capture.frames.length-1;this.info();this.debug.log('MuJoCo loaded '+this.file);this.pollLoop()}
 this.stopReplay();this.following=true;const result=await api<Update>('sim/'+this.liveId+'/action',{action,after:this.cursor,speed:Number(el<HTMLSelectElement>('speed').value)});if(gen!==this.generation)return;this.accept(result,action==='reset');this.debug.log('Simulation '+action+' · '+(this.capture?.frames[this.index]?.t??0).toFixed(3)+' s')
 }catch(e){report(e);this.debug.log(String(e));if(this.liveId){await this.release();this.state='Stopped';this.paint()}}finally{this.locked=false;this.paintTransport()}}
 private pollLoop(){clearInterval(this.timer);this.timer=window.setInterval(()=>void this.poll(),50)}
 private lastPoll=0
 private async poll(){if(!this.liveId||this.locked||this.polling||document.hidden)return;if(this.state!=='Running'&&performance.now()-this.lastPoll<20000)return
 this.polling=true;this.lastPoll=performance.now();const id=this.liveId
 try{const data=await api<Update>('sim/'+id+'?after='+this.cursor);if(id===this.liveId&&!this.locked)this.accept(data)}catch(e){if(id===this.liveId){await this.release();this.state='Stopped';this.paint();report(e)}}finally{this.polling=false}}
 private accept(data:Update,reset=false){if(!this.capture)return;if(!reset&&data.cursor<this.cursor)return
 if(reset||data.offset>this.cursor+1){this.capture.frames=data.frames.slice();this.offset=data.offset}
 else{const skip=Math.max(0,this.cursor+1-data.offset);this.capture.frames.push(...data.frames.slice(skip));const extra=this.capture.frames.length-2048;if(extra>0){this.capture.frames.splice(0,extra);this.offset+=extra}}
 this.cursor=data.cursor;if(this.following)this.index=Math.max(0,this.capture.frames.length-1);this.state=data.state==='playing'?'Running':data.state==='paused'?'Paused':data.state;if(data.state==='closed'){clearInterval(this.timer);this.liveId='';this.external=false}this.paint();if(data.error)this.debug.log(data.error)}
 async seek(index:number){this.stopReplay();if(this.state==='Running')await this.act('pause');if(!this.capture)return;this.following=false;this.index=Math.max(0,Math.min(index,this.capture.frames.length-1));this.paint()}
 info(){el('model-name').textContent=this.capture?.title||builtInModel(this.file)?.label||this.file||'No model';el('joints').replaceChildren();el('actuators').replaceChildren();el('solver').replaceChildren()
 const add=(id:string,label:string,value:string,color?:string)=>{const row=node('div','','field'),left=node('span',label);if(color){const s=node('i','','swatch');s.style.background=color;left.prepend(s)}row.append(left,node('output',value));el(id).append(row)}
 const c=this.capture;if(!c)return;c.joints.forEach((j,i)=>add('joints',j.name,'',tint(i)));if(c.actuators?.length){el('actuators').append(node('h3','Actuators'));c.actuators.forEach(a=>add('actuators',a.name,'—'))}add('solver','Δt',(c.dt*1000).toFixed(1)+' ms');add('solver','Hz',String(Math.round(1/c.dt)));add('solver','method',c.integrator)}
 paint(){const c=this.capture,f=c?.frames[this.index],canvas=el<HTMLCanvasElement>('scene');for(const b of document.querySelectorAll<HTMLElement>('[data-projection]'))b.setAttribute('aria-pressed',String(b.dataset.projection===this.camera.mode))
 if(c&&f&&canvas.clientWidth){scene(canvas,c,this.index,this.trace,this.camera);el('joints').querySelectorAll('output').forEach((o,i)=>o.textContent=f.q[i].toFixed(3)+' '+c.joints[i].unit);el('actuators').querySelectorAll('output').forEach((o,i)=>o.textContent=(f.actuatorForce?.[i]?.toFixed(2)??'—')+' '+(c.actuators?.[i].unit||''))}
 if(!f&&canvas.width){const g=canvas.getContext('2d');g?.clearRect(0,0,canvas.width,canvas.height)}
 el('scene-empty').hidden=!!(this.file||c);el('scene-note').hidden=!(this.file||c)
 el('scene-note').textContent=this.liveId?'MuJoCo '+(c?.engine||''):c?'Reference capture · MuJoCo '+c.engine:this.file?'Run model to initialize MuJoCo':'Select an MJCF model'
 el('time').textContent=(f?.t??0).toFixed(3)+' s';const slider=el<HTMLInputElement>('timeline');slider.max=String(Math.max(0,(c?.frames.length||1)-1));slider.value=String(this.index);slider.style.setProperty('--progress',(this.index/Math.max(1,+slider.max))*100+'%')
 el('state').textContent='Simulation · '+this.state;el('capture-label').textContent=c?c.frames.length+' samples':'Local workspace'
 this.paintTransport();this.debug.update(c,this.index)}
 private paintTransport(){
  const play=el<HTMLButtonElement>('play'),playing=this.state==='Running'||this.replaying
  const pressed=String(playing)
  if(play.getAttribute('aria-pressed')!==pressed){
   play.setAttribute('aria-pressed',pressed)
   play.innerHTML=icon(playing?'pause':'play')
   play.append(node('span',playing?'Pause':'Run sim'))
  }
  play.title=playing?'Pause simulation':'Play simulation'
  play.disabled=this.locked||!(this.file||this.capture)
  play.setAttribute('aria-busy',String(this.locked))
  play.dataset.paused=String(!playing&&(this.state==='Paused'||(!this.following&&!!this.capture)))
 }
 exportCsv(){
  choices('Export CSV',[
   ...(this.capture?[{label:'Simulation capture',do:()=>this.exportCapture()}]:[]),
   {label:'Session telemetry',do:()=>this.debug.export('csv')},
  ])
 }
 private exportCapture(){if(!this.capture){message('Run a model first.');return}download(csv(this.capture),this.file.replace(/.*\//,'').replace(/\.xml$/i,'')+'.csv');this.debug.log('Exported AdvantageScope capture')}
}
