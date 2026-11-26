import {basicSetup} from 'codemirror'
import {indentWithTab} from '@codemirror/commands'
import {javascript} from '@codemirror/lang-javascript'
import {json} from '@codemirror/lang-json'
import {python} from '@codemirror/lang-python'
import {HighlightStyle,syntaxHighlighting} from '@codemirror/language'
import {EditorState,type Text} from '@codemirror/state'
import {EditorView,keymap} from '@codemirror/view'
import {tags} from '@lezer/highlight'
import {api,button,confirmAction,message,node,query,run} from './ui.ts'

const highlighting=syntaxHighlighting(HighlightStyle.define([
 {tag:[tags.keyword,tags.operatorKeyword],color:'var(--accent)'},
 {tag:[tags.string,tags.regexp],color:'var(--green)'},
 {tag:[tags.number,tags.bool,tags.atom],color:'var(--trace-a)'},
 {tag:[tags.typeName,tags.function(tags.variableName),tags.propertyName],color:'var(--trace-b)'},
 {tag:tags.comment,color:'var(--muted)',fontStyle:'italic'},
 {tag:tags.invalid,color:'var(--danger)'},
]))

type OpenFile={path:string;revision:string;saved:Text;view:EditorView}

export function mountVisualEditor(host:HTMLElement,folder:string,onOpened:(file:string)=>void,onSaved:()=>void){
 const label=node('span','','visual-file-name')
 const saveButton=button('Save',save,'plain-action')
 const reloadButton=button('Reload',()=>{
  if(!current||saving)return
  const file=current.path
  if(dirty())confirmAction('Reload file','Discard your unsaved visual editor changes?','Discard and reload',()=>load(file))
  else return load(file)
 },'plain-action')
 const bar=node('div','','visual-filebar'),surface=node('div','','visual-editor-surface')
 let current:OpenFile|undefined,request:AbortController|undefined,saving=false,closed=false
 const dirty=()=>!!current&&!current.saved.eq(current.view.state.doc)
 const hasDraft=()=>dirty()||saving
 const beforeUnload=(event:BeforeUnloadEvent)=>{if(hasDraft())event.preventDefault()}
 window.addEventListener('beforeunload',beforeUnload)
 host.classList.add('visual-editor')
 bar.append(label,reloadButton,saveButton)
 host.append(bar,surface)
 draw()

 function draw(){
  label.textContent=current?current.path+(dirty()?' • Unsaved':''):'Open a file from the Explorer.'
  label.title=current?.path??''
  saveButton.disabled=!dirty()||saving
  saveButton.textContent=saving?'Saving…':'Save'
  reloadButton.disabled=!current||saving
 }

 async function save(){
  const file=current
  if(!file||!dirty()||saving)return
  // Cancel a pending file switch so the save and the visible buffer stay together.
  request?.abort()
  const state=file.view.state
  saving=true;draw()
  try{
   const result=await api<{revision:string}>('file',{
    folder,path:file.path,action:'save',revision:file.revision,text:state.sliceDoc(),
   })
   file.revision=result.revision
   file.saved=state.doc
   if(!closed)onSaved()
  }finally{
   saving=false
   if(!closed)draw()
  }
 }

 async function load(file:string){
  if(closed)return
  request?.abort()
  const pending=new AbortController()
  request=pending
  const prior=current
  const priorDoc=prior?.view.state.doc
  try{
   const {text,revision}=await api<{text:string;revision:string}>('file?'+new URLSearchParams({folder,path:file}),undefined,pending.signal)
   if(closed||request!==pending||pending.signal.aborted)return
   if(prior!==current||priorDoc!==prior?.view.state.doc){
    message('The editor changed while the file was opening. Open it again when ready.')
    return
   }
   const crlf=text.includes('\r\n')
   if(/\r(?!\n)/.test(text)||(crlf&&/(?<!\r)\n/.test(text)))
    throw new Error('This file has mixed or legacy line endings. Open it in LazyVim.')
   const lang=/\.py$/i.test(file)?python():/\.json$/i.test(file)?json():
    /\.(?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$/i.test(file)?javascript({typescript:/\.(?:ts|tsx|mts|cts)$/i.test(file),jsx:/\.[jt]sx$/i.test(file)}):[]
   const state=EditorState.create({
    doc:text,
    extensions:[
     basicSetup,lang,highlighting,EditorState.lineSeparator.of(crlf?'\r\n':'\n'),
     EditorView.contentAttributes.of({'aria-label':'Edit '+file}),
     keymap.of([{key:'Mod-s',run:()=>{run(save);return true}},indentWithTab]),
     EditorView.updateListener.of(update=>{if(update.docChanged)draw()}),
    ],
   })
   current?.view.destroy()
   const view=new EditorView({state,parent:surface})
   current={path:file,revision,saved:state.doc,view}
   onOpened(file)
   draw()
   if(surface.getClientRects().length)view.focus()
  }catch(error){
   if(!pending.signal.aborted)throw error
  }finally{
   if(request===pending)request=undefined
  }
 }

 return {
  async open(file:string){
   if(file===current?.path){
    request?.abort()
    current.view.focus()
   }else if(saving)message('Wait for the current save to finish.')
   else if(dirty())confirmAction('Open another file','Discard your unsaved visual editor changes?','Discard and open',()=>load(file))
   else await load(file)
  },
  focus:()=>current?.view.focus(),
  theme:()=>current?.view.requestMeasure(),
  hasDraft,
  async runFile(){
   if(!current)throw new Error('Open a runnable file first.')
   if(hasDraft())throw new Error('Save the current file (Ctrl+S) and run again.')
   const file=current,path=file.path
   const snapshot=await api<{revision:string}>(query('file',{folder,path}))
   if(file!==current||file.path!==path||hasDraft())throw new Error('The active file changed. Run it again.')
   if(snapshot.revision!==file.revision)throw new Error('The file changed on disk. Reload it before running.')
   return path
  },
  moved(from:string,to:string){
   if(!current||current.path!==from&&!current.path.startsWith(from+'/'))return
   request?.abort()
   current.path=to+current.path.slice(from.length)
   draw()
  },
  close(){
   closed=true
   request?.abort()
   window.removeEventListener('beforeunload',beforeUnload)
   current?.view.destroy()
   host.replaceChildren()
   host.classList.remove('visual-editor')
  },
 }
}
