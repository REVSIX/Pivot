import { button, choices, close, content, dialog, el, hue, message, modal, node } from './ui.ts'

const minutes={focus:25,break:5}
let phase:'focus'|'break'='focus'
let deadline=0,timer=0,transition=''
let renderDialog=()=>{}
const clockLabel=()=>phase==='focus'?'Focus':'Break'
function remaining(){
 const seconds=deadline?Math.max(0,Math.ceil((deadline-Date.now())/1000)):minutes[phase]*60
 return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')
}

function drawClock(){
 el('pivot-brand').hidden=!!(deadline||transition)
 const header=el('pomodoro-header')
 header.hidden=!(deadline||transition)
 header.classList.toggle('pomodoro-ready',!!transition)
 el('pomodoro-label').textContent=transition||clockLabel()
 const time=el('pomodoro-time')
 time.hidden=!deadline
 time.textContent=remaining()
 renderDialog()
}

function tick(){
 if(deadline&&Date.now()>=deadline){
  deadline=0
  clearInterval(timer)
  phase=phase==='focus'?'break':'focus'
  transition=phase==='break'?'Time to take a break!':'Time to work!'
  message(transition)
 }
 drawClock()
}

function pomodoro(){
 modal('Pomodoro')
 const time=node('output','','break-clock')
 const status=node('p','','hint')
 const toggle=button('',()=>{
  clearInterval(timer)
  if(deadline){deadline=0;phase='focus';transition='';drawClock();return}
  deadline=Date.now()+minutes[phase]*60000;transition=''
  close();drawClock()
  message(clockLabel()+' timer started.')
  timer=window.setInterval(tick,250)
 },'plain-action')
 renderDialog=()=>{
  if(!dialog.open||!time.isConnected){renderDialog=()=>{};return}
  time.textContent=remaining()
  status.textContent=transition||clockLabel()+(deadline?' in progress':'')
  toggle.textContent=deadline?'Reset timer':'Start '+minutes[phase]+'-minute '+phase
 }
 content.append(time,status,toggle);drawClock()
}
el('pomodoro-header').onclick=pomodoro

const words=`
above across action active again ahead align almost answer any area around arrive ask away base beach begin between
beyond board book bottle branch bread bridge bring build busy cable call carry catch center change charge circle clean
clear close cloud coast color column corner count cover craft create current cycle daily dance data deep detail device
different direct divide door down draw drive early earth easy edge edit empty enter equal event every field final find
first flag floor flow follow force form frame fresh friend front full garden gather glass goal green ground group grow
handle happy hard head help hold home image inside join keep key kind kitchen label large later layer learn leave light
limit line list little local long loose lower map mark match measure metal mind mix model motion motor move near next
night north notice number object open orbit order page paint panel paper part path pattern place plan point power press
price project pull quick quiet radio raise range reach read ready region relay repeat reset result return right river road
rock room round route sample scale screen search select sensor shape shift short show signal simple slide small solid
sound source space speed spring start state stay step still stop store story stream street strong surface switch table
teach test text think time title today together torque touch track tree turn under upper value vector voice wait walk
water wave week wheel wide window wire work world write young zero
`.trim().split(/\s+/)
function typing(){
 modal('Typing drill')
 const target=node('p','','typing-target'),input=node('input','','query'),score=node('output','','hint')
 input.setAttribute('aria-label','Type the words')
 input.spellcheck=false;input.autocomplete='off';input.setAttribute('autocapitalize','off')
 let prompt:string[]=[],started=0
 const entered=()=>input.value.trimStart().split(/\s+/)
 const draw=()=>{
  const typed=entered()
  target.replaceChildren()
  prompt.forEach((word,index)=>{
   if(index)target.append(' ')
   const value=typed[index]||''
   const piece=node('span','','typing-word')
   for(let i=0;i<word.length;i++){
    piece.append(node('span',word[i],i>=value.length?'':value[i]===word[i]?'typing-correct':'typing-wrong'))
   }
   if(value.length>word.length)piece.append(node('span',value.slice(word.length),'typing-wrong'))
   target.append(piece)
  })
 }
 const finish=()=>{
  if(!started||input.disabled)return
  const typed=entered()
  let correct=0,total=0
  for(let i=0;i<Math.max(prompt.length,typed.length);i++){
   const expected=prompt[i]||'',actual=typed[i]||''
   total+=Math.max(expected.length,actual.length)
   for(let j=0;j<expected.length;j++)if(expected[j]===actual[j])correct++
  }
  const elapsed=Math.max(.01,(performance.now()-started)/60000)
  score.textContent=Math.round(correct/5/elapsed)+' WPM · '+Math.round(correct/total*100)+'% accuracy'
  input.disabled=true
 }
 const reset=()=>{
  const pool=[...words]
  prompt=Array.from({length:18},()=>pool.splice(Math.floor(Math.random()*pool.length),1)[0])
  input.value='';input.disabled=false;input.focus();started=0;score.textContent='Enter to finish';draw()
 }
 input.oninput=()=>{
  if(!started&&input.value.trim())started=performance.now()
  draw()
 }
 input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();finish()}}
 content.append(target,input,score,button('Finish',finish,'plain-action'),button('New line',reset,'plain-action'));reset()
}

function snake(){
 modal('Snake')
 const board=node('canvas','','snake-board'),status=node('output','','hint')
 board.width=board.height=256;board.tabIndex=0;board.setAttribute('aria-label','Snake game. Use the arrow keys to turn.')
 const g=board.getContext('2d')
 if(!g)return
 const cells=16,size=board.width/cells
 let body=[8*cells+8,8*cells+7,8*cells+6],direction=[1,0],next=direction,food=8*cells+12,timer=0
 const cell=(index:number,color:string)=>{
  g.fillStyle=color;g.fillRect((index%cells)*size+1,Math.floor(index/cells)*size+1,size-2,size-2)
 }
 const draw=()=>{
  g.fillStyle=hue('bg');g.fillRect(0,0,board.width,board.height)
  cell(food,hue('accent'));body.forEach(index=>cell(index,hue('green')))
 }
 const arrows:Record<string,number[]>={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}
 board.onkeydown=event=>{
  const input=arrows[event.key]
  if(!input)return
  event.preventDefault()
  if(input[0]*direction[0]+input[1]*direction[1]===0)next=input
 }
 function tick(){
  if(!dialog.open||!board.isConnected){clearInterval(timer);return}
  direction=next
  const x=body[0]%cells+direction[0],y=Math.floor(body[0]/cells)+direction[1]
  const head=y*cells+x,grows=head===food
  if(x<0||y<0||x>=cells||y>=cells||body.slice(0,grows?body.length:-1).includes(head)){
   clearInterval(timer);status.textContent='Game over · '+(body.length-3)+' points';return
  }
  body.unshift(head)
  if(grows){
   const free=Array.from({length:cells*cells},(_,index)=>index).filter(index=>!body.includes(index))
   if(!free.length){clearInterval(timer);status.textContent='Board cleared';return}
   food=free[Math.floor(Math.random()*free.length)]
  }else body.pop()
  status.textContent=(body.length-3)+' points';draw()
 }
 const start=button('Start / restart',()=>{
  clearInterval(timer);body=[8*cells+8,8*cells+7,8*cells+6];direction=[1,0];next=direction;food=8*cells+12
  draw();status.textContent='0 points';board.focus();timer=window.setInterval(tick,125)
 },'plain-action')
 status.textContent='Use arrow keys to turn.'
 content.append(board,status,start);draw()
}

export function fidgetbox(){
 choices('Fidgetbox',[
  {label:'Pomodoro',do:pomodoro},{label:'Typing drill',do:typing},{label:'Snake',do:snake},
 ])
}
