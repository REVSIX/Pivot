import {api,button,choices,close,confirmAction,content,dialog,el,fuzzy,glyph,message,modal,node,pref,promptText,query,readPref,run,type Action} from './ui.ts'
import {fileIcon} from './icons.ts'
import {diffView} from './diff.ts'
import type {Project} from './model.ts'
type Entry={name:string;path:string;kind:'file'|'directory'}
type Change={path:string;index:string;worktree:string}
type Git={available:boolean;branch:string;changes:Change[];branches:string[];remote:boolean;topLevel:boolean}
type Task={id:string;label:string;command:string}
export class Explorer{
 project:Project;selected='';expanded:Set<string>;git?:Git;tasks:Task[]=[];wsl=false;revision=0
 private dragged=''
 constructor(project:Project,readonly openFile:(file:string)=>void,readonly openProject:(folder:string)=>Promise<void>,readonly task:(id:string)=>void,readonly onMove:(from:string,to:string)=>void){this.project=project;this.expanded=new Set(readPref<string[]>('tree.'+project.folder,['.','src','models']))}
 async refresh(){
  const rev=++this.revision,folder=this.project.folder
  const [git,tools]=await Promise.all([api<Git>(query('git',{folder})),api<{tasks:Task[];wsl:boolean}>(query('tasks',{folder}))])
  if(rev!==this.revision)return;this.git=git;this.tasks=tools.tasks;this.wsl=tools.wsl;this.source();this.taskList();await this.tree()
 }
 dispose(){this.revision++}
 async tree(){
  const rev=++this.revision, out=document.createDocumentFragment(),folder=this.project.folder
  const expand=async(dir:string,depth:number)=>{
   const {entries,truncated}=await api<{entries:Entry[];truncated:boolean}>(query('tree',{folder,path:dir}))
   if(rev!==this.revision)return
   for(const entry of entries){
    const isDir=entry.kind==='directory',b=button('',()=>isDir?this.toggle(entry.path):this.openFile(entry.path),'tree-row'+(entry.path===this.selected?' active':''));b.style.paddingLeft=(8+depth*12)+'px';b.dataset.file=entry.path;b.title=entry.path
    b.append(isDir?glyph('arrow','arrow'+(this.expanded.has(entry.path)?' open':'')):node('span','','arrow'),glyph(isDir?'folder':fileIcon(entry.name),isDir?'dir-icon':'file-icon'),node('span',entry.name,'name'))
    const change=this.git?.changes.find(c=>c.path===entry.path);if(change)b.append(node('span',mark(change),'git-mark'+(mark(change)==='U' || mark(change)==='A'?' add':'')))
    b.oncontextmenu=e=>{e.preventDefault();this.files(entry.path)}
    b.draggable=true
    b.ondragstart=e=>{if(!e.dataTransfer)return;this.dragged=entry.path;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',entry.path)}
    b.ondragend=()=>{this.dragged=''}
    if(isDir)this.dropTarget(b,entry.path)
    out.append(b)
    if(isDir&&this.expanded.has(entry.path))await expand(entry.path,depth+1)
   }
   if(truncated)out.append(node('p','Directory listing limited.','hint'))
  }
  const rootLabel=folder==='.'?this.project.rootName:folder.split('/').at(-1)!
  const root=button('',()=>this.toggle('.'),'tree-row');root.append(glyph('arrow','arrow'+(this.expanded.has('.')?' open':'')),glyph('folder','dir-icon'),node('strong',rootLabel,'name'));this.dropTarget(root,'.');out.append(root)
  if(this.expanded.has('.'))await expand('.',1)
  if(rev===this.revision)el('tree').replaceChildren(out)
 }
 private dropTarget(row:HTMLButtonElement,dir:string){
  const target=(from:string)=>dir==='.'?from.split('/').at(-1)!:dir+'/'+from.split('/').at(-1)!
  const canDrop=()=>this.dragged&&this.dragged!==dir&&!dir.startsWith(this.dragged+'/')&&target(this.dragged)!==this.dragged
  row.ondragover=e=>{if(!e.dataTransfer||!canDrop())return;e.preventDefault();e.dataTransfer.dropEffect='move';row.classList.add('drop-target')}
  row.ondragleave=()=>row.classList.remove('drop-target')
  row.ondrop=e=>{
   row.classList.remove('drop-target')
   if(!canDrop())return
   e.preventDefault()
   const from=this.dragged,to=target(from)
   this.dragged=''
   run(()=>this.move(from,to,dir))
  }
 }
 private async move(from:string,to:string,expand?:string){
  await api('file',{action:'rename',path:from,to,folder:this.project.folder})
  for(const path of [...this.expanded]){
   if(path===from||path.startsWith(from+'/')){this.expanded.delete(path);this.expanded.add(to+path.slice(from.length))}
  }
  if(expand)this.expanded.add(expand)
  pref('tree.'+this.project.folder,[...this.expanded])
  this.onMove(from,to)
  await this.refresh()
  message('Moved to '+to)
 }
 async toggle(path:string){if(this.expanded.has(path))this.expanded.delete(path);else this.expanded.add(path);pref('tree.'+this.project.folder,[...this.expanded]);await this.tree()}
 select(file:string){this.selected=file;for(const row of el('tree').querySelectorAll<HTMLElement>('[data-file]'))row.classList.toggle('active',row.dataset.file===file)}
 files(target=this.selected){
  const parent=target.includes('/')?target.slice(0,target.lastIndexOf('/')+1):''
  const mutate=async(action:string,path:string,to?:string)=>{await api('file',{action,path,to,confirm:action==='delete'?path:undefined,folder:this.project.folder});await this.refresh();if(action==='create'||action==='rename')this.openFile(to||path)}
  const actions:Action[]=[{label:'Create file',do:()=>promptText('Create file','Project-relative path',parent,v=>mutate('create',v))},{label:'Create directory',do:()=>promptText('Create directory','Project-relative path',parent,v=>mutate('mkdir',v))}]
  if(target)actions.push({label:'Rename '+target,do:()=>promptText('Rename','New project-relative path',target,v=>this.move(target,v))},{label:'Reveal '+target,do:()=>mutate('reveal',target)},{label:'Delete '+target,do:()=>confirmAction('Delete entry','Permanently remove '+target+' from disk? Directories must be empty.','Delete '+target,()=>mutate('delete',target))})
  choices('File operations',actions)
 }
 async find(){
  modal('Find file');const input=node('input','','query');input.placeholder='Filter paths in this project';input.setAttribute('aria-label','Find file');const list=node('div');content.append(input,list);input.focus()
  const pending=['.'],paths:string[]=[];let active=0,items:string[]=[]
  const draw=()=>{items=paths.map(path=>({path,s:fuzzy(path,input.value)})).filter(x=>x.s>=0).sort((a,b)=>b.s-a.s).slice(0,80).map(x=>x.path);active=Math.min(active,Math.max(0,items.length-1));list.replaceChildren(...items.map((p,i)=>button(p,()=>{close();this.openFile(p)},'choice'+(i===active?' selected':''))))}
  input.oninput=()=>{active=0;draw()};input.onkeydown=e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,Math.min(items.length-1,active+(e.key==='ArrowDown'?1:-1)));draw();list.children[active]?.scrollIntoView({block:'nearest'})}else if(e.key==='Enter'&&items[active]){close();this.openFile(items[active])}}
  let dirs=0
  while(pending.length&&input.isConnected&&paths.length<2000&&dirs++<128){const {entries}=await api<{entries:Entry[]}>(query('tree',{folder:this.project.folder,path:pending.shift()!}));for(const entry of entries){if(entry.kind==='directory')pending.push(entry.path);else paths.push(entry.path)}draw()}
 }
 async mutate(action:string,extra:object={}){const res=await api<{output:string}>('git',{folder:this.project.folder,action,...extra});await this.refresh();message(res.output)}
 async showDiff(c:Change,staged:boolean){
  modal(c.path)
  const view=node('div','','split-diff'),comparison=node('div','Loading comparison…','hint')
  const hasStaged=c.index!==' '&&c.index!=='?',hasWorking=c.worktree!==' '||c.index==='?'
  if(hasStaged&&hasWorking){
   const modes=node('div','','diff-modes')
   for(const [label,isStaged] of [['Working changes',false],['Staged changes',true]] as const){
    const toggle=button(label,()=>this.showDiff(c,isStaged),'plain-action')
    toggle.setAttribute('aria-pressed',String(staged===isStaged));modes.append(toggle)
   }
   view.append(modes)
  }
  view.append(comparison);content.append(view);content.scrollTop=0
  try{
   const {text}=await api<{text:string}>(query('diff',{folder:this.project.folder,path:c.path,staged:staged?'1':'0',full:'1'}))
   if(!dialog.open||!view.isConnected)return
   comparison.className=''
   comparison.replaceChildren(diffView(text,staged?'HEAD':'Index',staged?'Staged':'Working tree'))
  }catch(error){
   if(view.isConnected)comparison.textContent=error instanceof Error?error.message:'Could not load the comparison.'
  }
 }
 source(){
  const git=this.git;el('branch').querySelector('span')!.textContent=git?.available?git.branch:'Local folder'
  const changes=el('changes');changes.replaceChildren()
  if(!git?.changes.length)changes.append(node('p',git?.available?'Working tree clean':'No Git repository','empty'))
  else for(const c of git.changes){const row=node('div','','change-row'),staged=c.index!==' '&&c.index!=='?',dirty=c.worktree!==' '||c.index==='?';row.append(glyph(fileIcon(c.path),'file-icon'),button(c.path,()=>this.showDiff(c,!dirty),'path'),node('small',mark(c),'git-mark'))
   if(git.topLevel){if(dirty){const b=button('+',()=>this.mutate('stage',{path:c.path}));b.title='Stage '+c.path;row.append(b)}if(staged){const b=button('−',()=>this.mutate('unstage',{path:c.path}));b.title='Unstage '+c.path;row.append(b)}}changes.append(row)}
  const form=el<HTMLFormElement>('commit-form'),input=el<HTMLInputElement>('commit-message')
  form.hidden=!git?.topLevel;const commit=el<HTMLButtonElement>('commit');const update=()=>{commit.disabled=!input.value.trim()||!git?.changes.some(c=>c.index!==' '&&c.index!=='?')};update();input.oninput=update
  form.onsubmit=e=>{e.preventDefault();if(!commit.disabled)run(async()=>{commit.disabled=true;await this.mutate('commit',{message:input.value});input.value='';update()})}
  const push=el<HTMLButtonElement>('push');push.hidden=!git?.topLevel;push.disabled=!git?.remote
  push.onclick=()=>run(async()=>{push.disabled=true;try{await this.mutate('push')}finally{push.disabled=!this.git?.remote}})
  input.onkeydown=e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();form.requestSubmit()}}
 }
 gitMenu(){choices('Source control',[{label:'Refresh status',do:()=>this.refresh()},{label:'Clone repository',do:()=>this.clone()},...this.gitActions()])}
 gitActions(){
  const actions:Action[]=[];const g=this.git
  if(g?.topLevel){for(const b of g.branches.filter(b=>b!==g.branch))actions.push({label:'Switch to '+b,do:()=>this.mutate('checkout',{branch:b})})
   actions.push({label:'Create branch',do:()=>promptText('Create branch','New branch name','',branch=>this.mutate('branch',{branch}))})
   if(g.remote)for(const a of ['fetch','pull','push'])actions.push({label:a+' remote',do:()=>a==='fetch'?this.mutate(a):confirmAction('Git '+a,'Run git '+a+' for '+g.branch+'?','Continue',()=>this.mutate(a))})
  }
  for(const t of this.tasks.filter(t=>t.id.startsWith('github:')))actions.push({label:t.label,do:()=>this.task(t.id)})
  return actions
 }
 clone(){promptText('Clone repository','HTTPS / SSH URL or local workspace-relative path','',url=>promptText('Clone destination','New folder name',url.split(/[/:]/).at(-1)?.replace(/\.git$/,'')||'',async name=>{const r=await api<{folder:string}>('clone',{folder:this.project.folder,url,name});await this.openProject(r.folder)}))}
 taskList(){const tray=el('tasks');tray.replaceChildren();for(const [label,items] of [['Run & build',this.tasks.filter(t=>!t.id.startsWith('docker:')&&!t.id.startsWith('github:'))],['Docker',this.tasks.filter(t=>t.id.startsWith('docker:'))]] as const){if(!items.length)continue;const d=node('details'),s=node('summary',label);d.append(s);for(const t of items){const b=button(t.label,()=>this.runTask(t.id),'task-choice');b.title=t.command;d.append(b)}tray.append(d)}}
 runTask(id:string){const t=this.tasks.find(t=>t.id===id);if(t)confirmAction(t.label,'Run in the project terminal: '+t.command,'Run task',()=>this.task(id))}
}
function mark(c:Change){return c.index==='?'?'U':(c.worktree.trim()||c.index.trim())}
