import {node} from './ui.ts'

type Line={number:number;text:string}
type Row={before?:Line;after?:Line;changed?:boolean;gap?:boolean}

export function splitPatch(patch:string){
 const rows:Row[]=[]
 let left=0,right=0,inHunk=false,noNewline=false
 let removed:Line[]=[],added:Line[]=[]
 function flush(){
  for(let i=0;i<Math.max(removed.length,added.length);i++){
   rows.push({before:removed[i],after:added[i],changed:true})
  }
  removed=[];added=[]
 }
 for(const line of patch.split('\n')){
  const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if(hunk){
   flush()
   left=Number(hunk[1]);right=Number(hunk[2])
   if(inHunk||left>1||right>1)rows.push({gap:true})
   inHunk=true
   continue
  }
  if(line.startsWith('diff --git ')){flush();inHunk=false;continue}
  if(!inHunk)continue
  const text=line.slice(1).replace(/\r$/,'')
  switch(line[0]){
   case '-':removed.push({number:left++,text});break
   case '+':added.push({number:right++,text});break
   case ' ':flush();rows.push({before:{number:left++,text},after:{number:right++,text}});break
   case '\\':noNewline=true;break
  }
 }
 flush()
 return {rows,noNewline}
}

function changedRange(before:string,after:string){
 let start=0,end=0
 const length=Math.min(before.length,after.length)
 while(start<length&&before[start]===after[start])start++
 while(start+end<length&&before[before.length-1-end]===after[after.length-1-end])end++
 return {start,end}
}

export function diffView(patch:string,beforeLabel:string,afterLabel:string){
 const {rows,noNewline}=splitPatch(patch)
 if(!rows.length)return node('pre',patch,'diff')
 const view=node('div'),table=node('table','','diff-table'),columns=node('colgroup')
 for(let i=0;i<4;i++)columns.append(node('col','',i%2===0?'diff-gutter':''))
 const head=table.createTHead().insertRow()
 for(const label of [beforeLabel,afterLabel]){
  const cell=node('th',label);cell.colSpan=2;cell.scope='colgroup';head.append(cell)
 }
 const body=table.createTBody()
 for(const row of rows.slice(0,5000)){
  const tr=body.insertRow()
  if(row.gap){
   const gap=tr.insertCell();gap.colSpan=4;gap.className='diff-gap';gap.textContent='Unchanged lines omitted';continue
  }
  const range=row.changed&&row.before&&row.after?changedRange(row.before.text,row.after.text):undefined
  for(const [line,tone] of [[row.before,'removed'],[row.after,'added']] as const){
   const gutter=tr.insertCell(),code=tr.insertCell()
   const state=row.changed?(line?tone:'blank'):''
   gutter.className='diff-number '+state
   code.className='diff-code '+state
   if(!line)continue
   gutter.textContent=(state?(tone==='added'?'+ ':'− '):'')+line.number
   if(range){
    const end=line.text.length-range.end
    code.append(line.text.slice(0,range.start),node('mark',line.text.slice(range.start,end),'diff-emphasis'),line.text.slice(end))
   }else code.textContent=line.text
  }
 }
 table.prepend(columns)
 view.append(table)
 if(noNewline)view.append(node('p','A version has no newline at the end of the file.','hint'))
 if(rows.length>5000)view.append(node('p','Showing the first 5,000 comparison rows.','hint'))
 return view
}
