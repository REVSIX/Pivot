import './style.css'
import {icon} from './icons.ts'
import {api,bridge,button,choices,close,confirmAction,content,dialog,el,fuzzy,message,modal,native,node,pref,promptText,query,readPref,report,run,setToken,token,type Action} from './ui.ts'
import {initializeLayout,current,focusEditorLayout,layoutActions,modeActions,setMode,showShell,sidebar,type Mode} from './layout.ts'
import {installSimulationFullscreen} from './simulation-fullscreen.ts'
import {Instrument} from './instrument.ts'
import {Appearance} from './appearance.ts'
import {Explorer} from './explorer.ts'
import type {Project} from './model.ts'
import type {Session} from './editor.ts'
const instrument=new Instrument()
let project:Project|undefined,explorer:Explorer|undefined,editor:Session|undefined
let selected='',epoch=0,refreshTimer=0,editorLoading=false,shellSequence=0,activeShell=0
type Shell={id:number;label:string;host:HTMLElement;session?:Session;ended:boolean;runFile?:string}
const shells:Shell[]=[]
let editorThemeTimer=0
let refreshPaletteCatalog=()=>{}
const appearance=new Appearance((colors,preview)=>{
 clearTimeout(editorThemeTimer)
 const session=editor
 session?.theme(preview?undefined:colors)
 if(preview&&session)editorThemeTimer=window.setTimeout(()=>{if(editor===session)session.theme(colors)},150)
 shells.forEach(s=>s.session?.theme())
 instrument.paint()
})
function shellTabs(){const bar=el('shell-tabs');bar.replaceChildren();for(const sh of shells){const b=button(sh.label,()=>activateShell(sh.id),sh.id===activeShell?'active':'');bar.append(b);sh.host.hidden=sh.id!==activeShell};if(!shells.length){const note=node('div','','shell-placeholder');note.append(button('Open terminal',()=>newShell(),'plain-action'));el('shell-hosts').replaceChildren(note)}el<HTMLButtonElement>('close-shell').disabled=!shells.length}
function activateShell(id:number){activeShell=id;shellTabs();shells.find(x=>x.id===id)?.session?.focus()}
async function newShell({task,shell='native',focus=true,runFile}:{
 task?:string;shell?:'native'|'wsl'|'serial';focus?:boolean;runFile?:string
}={}){
 if(!project)return
 const gen=epoch,folder=project.folder,{launch}=await import('./editor.ts');if(gen!==epoch)return
 if(runFile)for(const entry of shells.filter(s=>s.runFile&&s.ended))removeShell(entry.id)
 if(shells.length>=4){message('Close a terminal before opening another.');return}
 if(focus)showShell()
 const id=++shellSequence,host=node('div','','shell-instance'),screen=node('div','','shell-screen')
 const label=runFile?'Run · '+runFile.split('/').at(-1):task?task.split(':').at(-1)!:shell==='wsl'?'WSL':shell==='serial'?'Serial Monitor':'Shell '+id
 host.append(screen)
 el('shell-hosts').querySelector('.shell-placeholder')?.remove();el('shell-hosts').append(host)
 const sh:Shell={id,label,host,ended:false,runFile};shells.push(sh);activeShell=id;shellTabs()
 sh.session=launch(screen,token,folder,'terminal',{shell,task,runFile},reason=>{
  sh.ended=true
  host.append(node('p',reason,'shell-exit'))
  instrument.debug.log(label+' · '+reason)
  if(gen===epoch)refreshSoon()
 },()=>{if(focus&&gen===epoch&&activeShell===id&&host.getClientRects().length&&!dialog.open)sh.session?.focus()})
}
function removeShell(id:number){const i=shells.findIndex(s=>s.id===id);if(i<0)return;const sh=shells.splice(i,1)[0];sh.session?.close();sh.host.remove();activeShell=shells.at(-1)?.id||0;shellTabs()}
function closeShell(){const sh=shells.find(s=>s.id===activeShell);if(!sh)return;if(sh.ended){removeShell(sh.id);return}confirmAction('Close terminal','End '+sh.label+' and any process running in it?','Close terminal',()=>removeShell(sh.id))}
function refreshSoon(){clearTimeout(refreshTimer);refreshTimer=window.setTimeout(()=>{if(explorer)run(()=>explorer!.refresh())},650)}
function showSelected(){explorer?.select(selected)}
function fileMoved(from:string,to:string){
 if(!project)return
 editor?.moved(from,to)
 if(selected===from||selected.startsWith(from+'/')){
  selected=to+selected.slice(from.length)
  pref('file.'+project.folder,selected)
  showSelected()
 }
 instrument.modelMoved(from,to)
}
function focusEditor(){focusEditorLayout();if(editor)editor.focus();else return startEditor(selected||undefined)}
function focusTerminal(){
 const live=shells.filter(s=>!s.ended)
 if(!live.length){message('No open terminal. Use New terminal to start one.');return}
 const focus=(id:number)=>{showShell();activateShell(id)}
 if(live.length===1){focus(live[0].id);return}
 choices('Open existing terminal',live.map(s=>({label:s.label,key:s.id===activeShell?'Active':'',do:()=>focus(s.id)})))
}
function showSidebar(view:'explorer'|'git',force=false){
 const workbench=el('workbench'),same=workbench.dataset.sidebar===view
 const maximized=workbench.dataset.max==='code-pane'
 if(maximized)setMode(current)
 workbench.dataset.sidebar=view
 for(const name of ['explorer','git'])el('rail-'+name).classList.toggle('active',name===view)
 sidebar(force||!same||maximized)
}
let readingRunFile=false
async function runCurrentFile(){
 const session=editor
 if(!session){message('Open a file in LazyVim first.');return}
 const running=shells.find(shell=>shell.runFile&&!shell.ended)
 if(running){showShell();activateShell(running.id);message('A file run is already active.');return}
 if(readingRunFile)return
 readingRunFile=true
 try{
  const runFile=await session.runFile()
  if(editor===session)await newShell({runFile})
 }finally{readingRunFile=false}
}
function stopTerminal(){
 const terminal=shells.find(shell=>shell.id===activeShell&&!shell.ended)
 if(terminal?.session)terminal.session.interrupt()
 else message('Select a live terminal to send Ctrl+C.')
}
async function startEditor(file?:string){
 if(!project||editorLoading)return;if(editor){if(file)editor.open(file);return}
 const gen=epoch,folder=project.folder;editorLoading=true;el('editor-message').textContent='Starting LazyVim…'
 try{const {launch}=await import('./editor.ts');if(gen!==epoch)return
 editor=launch(el('editor-screen'),token,folder,'editor',{file,profile:readPref('profile','pivot')},reason=>{if(gen!==epoch)return;editor=undefined;el('editor-screen').replaceChildren();el('editor-message').replaceChildren(node('p',reason,'hint'),button('Reconnect editor',()=>startEditor(selected),'plain-action'));instrument.debug.log(reason);refreshSoon()},
 ()=>{if(gen!==epoch)return;el('editor-message').textContent='';if(selected&&selected!==file)editor?.open(selected);editor?.theme(appearance.selected.colors);if((current==='code'||current==='split')&&!dialog.open&&!(document.activeElement?.closest('#term-pane')))editor?.focus()})
 }catch(e){el('editor-message').textContent='Editor unavailable. See terminal setup in README.';report(e)}finally{if(gen===epoch)editorLoading=false}}
async function openFile(file:string){if(!project)return;selected=file;pref('file.'+project.folder,file);showSelected();if(current!=='code'&&current!=='split')setMode('code');await startEditor(file)}
let explorerOpen=0
async function openExplorerFile(file:string){
 const request=++explorerOpen,workspace=project
 if(!workspace)return
 if(current!=='simulation')return openFile(file)
 if(/\.xml$/i.test(file)){
  const {text}=await api<{text:string}>(query('file',{folder:workspace.folder,path:file}))
  if(request!==explorerOpen||workspace!==project||current!=='simulation')return
  const root=new DOMParser().parseFromString(text,'application/xml').documentElement
  if(root.tagName==='mujoco'){explorer?.select(file);await instrument.model(file);return}
 }
 choices(file,[{label:'Open in Editor',do:()=>openFile(file)}])
}
async function switchProject(folder:string){
 if(project?.folder===folder){close();return}
 if(editor||shells.some(s=>!s.ended)){confirmAction('Switch project','Save open buffers first. Switching ends the editor, terminals, and simulation for this project.','Switch project',()=>loadProject(folder));return}
 await loadProject(folder)
}
async function loadProject(folder:string){
 const next=await api<Project>(query('project',{folder}))
 if(project)close()
 epoch++;const gen=epoch;explorer?.dispose()
 editor?.close();editor=undefined;editorLoading=false;el('editor-screen').replaceChildren();el('editor-message').textContent='';while(shells.length)removeShell(shells[0].id);shellSequence=0
 project=next;pref('folder',folder);el('project-name').querySelector('span')!.textContent=folder==='.'?next.rootName:folder.split('/').at(-1)!
 explorer=new Explorer(next,f=>run(()=>openExplorerFile(f)),switchProject,id=>run(()=>newShell({task:id})),(from,to)=>{if(gen===epoch)fileMoved(from,to)},f=>run(()=>openFile(f)))
 await Promise.all([explorer.refresh(),instrument.setProject(next)])
 if(gen!==epoch)return
 selected=readPref('file.'+folder,'')
 if(selected){try{await api('file?'+new URLSearchParams({folder,path:selected}))}catch{selected=''}}
 if(gen!==epoch)return
 selected=selected||next.files.find(f=>f==='controller.py')||next.files.find(f=>/\.(py|ts|xml|md|lua|js)$/i.test(f))||''
 showSelected();instrument.debug.log('Project ready · '+(next.git?.branch||'local'))
 await Promise.all([startEditor(selected||undefined),newShell({focus:false})]);instrument.paint()
}
async function browse(folder=project?.folder||'.'){
 modal('Open project folder');const p=await api<Project>(query('project',{folder}));if(!dialog.open||el('dialog-title').textContent!=='Open project folder')return;content.replaceChildren(node('p',p.rootName+' / '+(folder==='.'?'':folder),'hint'))
 content.append(button('Open this folder',()=>switchProject(folder),'choice selected'))
 if(native)content.append(button('Browse computer…',()=>{close();confirmAction('Open another workspace','Save open buffers before changing the desktop workspace root.','Choose folder',()=>bridge('open-folder'))}))
 if(folder!=='.')content.append(button('↑ Parent folder',()=>browse(folder.split('/').slice(0,-1).join('/')||'.')))
 p.folders.forEach(f=>content.append(button(f+' /',()=>browse(folder==='.'?f:folder+'/'+f))))
}
function openThemes(){
 const refresh=choices('Themes',appearance.themeActions(),'Filter themes…',{
  previewOnFilter:false,resetPreview:()=>appearance.resetPreview(),
 })
 refreshPaletteCatalog=()=>refresh(appearance.themeActions())
 if(token)void appearance.loadCatalog().then(refreshPaletteCatalog)
}
function settings(){choices('Workspace settings',[{label:'Themes',do:openThemes},{label:'Create custom palette',do:()=>appearance.customize()},...appearance.translucencyActions(),{label:'Workspace background',do:()=>appearance.background()},{label:'Editor profile · '+readPref('profile','pivot'),do:profileMenu},{label:'Music dock',do:music}])}
function profileMenu(){choices('Neovim profile',['pivot','user'].map(p=>({label:p==='pivot'?'Pivot · bundled LazyVim':'Personal · installed Neovim configuration',do:()=>confirmAction('Change editor profile','Save files before restarting the editor. The personal profile loads your installed configuration.','Use profile',async()=>{pref('profile',p);editor?.close();editor=undefined;el('editor-screen').replaceChildren();await startEditor(selected)})})))}
function music(){const host=el('spotify-frame')
 if(host.children.length){host.replaceChildren();host.hidden=true;el('music-caption').textContent='Open player';return}
 promptText('Spotify player','Spotify track, playlist, album, or episode URL',readPref('spotify',''),value=>{
 const u=new URL(value),match=/^\/(?:intl-[a-z]+\/)?(track|playlist|album|episode)\/([A-Za-z0-9]{22})\/?$/.exec(u.pathname)
 if(u.origin!=='https://open.spotify.com'||!match)throw Error('Use an open.spotify.com track, playlist, album, or episode link.')
 const frame=node('iframe');frame.title='Spotify player';frame.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';frame.src='https://open.spotify.com/embed/'+match[1]+'/'+match[2]+'?theme=0';host.replaceChildren(frame);host.hidden=false;pref('spotify',u.href);el('music-caption').textContent='Close player'})}
function palette(){
 const actions:Action[]=[
  ...modeActions,...layoutActions,...(explorer?.gitActions()||[]),
  {label:'Open project folder',do:()=>browse()},
  {label:'Find file in project',do:()=>explorer?.find()},
  {label:'File operations · create, rename, delete, reveal',do:()=>explorer?.files()},
  {label:'Clone Git repository',do:()=>explorer?.clone()},
  {label:'Git branches and remote operations',do:()=>explorer?.gitMenu()},
  {label:'Refresh explorer and Git status',do:()=>explorer?.refresh()},
  {label:'Run current file',do:runCurrentFile},
  {label:'Stop terminal (Ctrl+C)',do:stopTerminal},
  {label:'New terminal',do:()=>newShell()},
  {label:'Serial Monitor',do:()=>newShell({shell:'serial'})},
  {label:'Close terminal',do:closeShell},
  {label:'Focus LazyVim fullscreen',do:focusEditor},
  {label:'Open existing terminal',do:focusTerminal},
  {label:'Show source control sidebar',do:()=>showSidebar('git',true)},
  {label:'Select MJCF model',do:()=>instrument.models()},
  {label:'Run simulation',do:()=>{if(current!=='simulation'&&current!=='split')setMode('simulation');return instrument.runModel()}},
  {label:'Pause simulation',do:()=>instrument.act('pause')},
  {label:'Step simulation',do:()=>instrument.act('step')},
  {label:'Reset simulation',do:()=>instrument.act('reset')},
  {label:'Export CSV',do:()=>instrument.exportCsv()},
  {label:'Export telemetry as MCAP',do:()=>instrument.debug.export('mcap')},
  {label:'Select debug channels',do:()=>instrument.debug.channelsDialog()},
  {label:'Themes',do:openThemes},
  {label:'Create custom palette',do:()=>appearance.customize()},
  ...appearance.translucencyActions(),
  {label:'Workspace background',do:()=>appearance.background()},
  {label:'Fidgetbox',do:async()=>{const {fidgetbox}=await import('./fidgetbox.ts');fidgetbox()}},
  {label:'Spotify player',do:music},
  {label:'Editor profile',do:profileMenu}
 ]
 if(explorer?.wsl)actions.push({label:'New WSL terminal',do:()=>newShell({shell:'wsl'})})
 for(const t of explorer?.tasks||[])actions.push({label:'Task · '+t.label,do:()=>explorer?.runTask(t.id)})
 choices('Command palette',actions,'Type a command…',{
  score:(action,value)=>{
   const query=value.trim().toLowerCase()
   const format=query.match(/\b(?:csv|mcap)\b/)?.[0]
   if(format&&!action.label.toLowerCase().includes(format))return -1
   return fuzzy(action.label,query)
  },
 })
}
for(const i of document.querySelectorAll<HTMLElement>('[data-icon]'))i.innerHTML=icon(i.dataset.icon!)
el('window-controls').hidden=!native
for(const b of document.querySelectorAll<HTMLButtonElement>('[data-window]'))b.onclick=()=>bridge(b.dataset.window!)
const drag=document.querySelector<HTMLElement>('.title-drag')!;drag.onpointerdown=e=>{if(e.button===0&&native)bridge('drag')};drag.ondblclick=()=>bridge('maximize')
el('settings').onclick=settings;el('palette').onclick=()=>palette();el('music').onclick=music;el('dismiss').onclick=close
el('project-name').onclick=()=>run(()=>browse());el('branch').onclick=()=>explorer?.gitMenu();el('git-menu').onclick=()=>explorer?.gitMenu();el('new-file').onclick=()=>explorer?.files();el('refresh').onclick=()=>run(()=>explorer?.refresh())
el('new-shell').onclick=()=>run(()=>newShell());el('close-shell').onclick=closeShell
el('run').onclick=()=>run(()=>current==='simulation'?instrument.runModel():runCurrentFile());el('stop').onclick=stopTerminal
el('rail-explorer').classList.add('active');el('rail-explorer').onclick=()=>showSidebar('explorer');el('rail-search').onclick=()=>run(()=>explorer?.find());el('rail-git').onclick=()=>showSidebar('git');el('rail-debug').onclick=()=>setMode('debug');el('rail-run').onclick=()=>choices('Project tasks',(explorer?.tasks||[]).map(t=>({label:t.label,do:()=>explorer?.runTask(t.id)})))
document.addEventListener('keydown',e=>{
 if(e.ctrlKey&&e.shiftKey&&e.code==='KeyP'){e.preventDefault();e.stopImmediatePropagation();if(dialog.open)close();else palette();return}
 if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&/^Digit[1-4]$/.test(e.code)&&!dialog.open){e.preventDefault();e.stopImmediatePropagation();setMode((['code','debug','simulation','split'] as Mode[])[Number(e.code.slice(-1))-1]);return}
 if(e.key==='Enter'&&(e.target as HTMLElement).closest('#code-pane,#term-pane'))refreshSoon()
},true)
window.addEventListener('focus',refreshSoon)
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refreshSoon();instrument.paint()}})
document.addEventListener('contextmenu',event=>event.preventDefault())
async function boot(){installSimulationFullscreen();initializeLayout(()=>{
 const control=el('run'),label=current==='simulation'?'Run simulation':'Run file'
 control.title=label;control.setAttribute('aria-label',label);control.querySelector('span')!.textContent=label
 instrument.paint()
 });appearance.apply();const session=await api<{token:string;initial:string}>('session');setToken(session.token);instrument.sessionToken=session.token
 void appearance.loadCatalog().then(()=>refreshPaletteCatalog())
 const saved=readPref('folder',session.initial);try{await loadProject(saved)}catch(e){if(saved===session.initial)throw e;await loadProject(session.initial)}}
void boot().catch(report)
