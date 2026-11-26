import {button,close,content,dialog,el,glyph,message,modal,node,pref,readPref} from './ui.ts'

const phases={focus:'Focus',shortBreak:'Short break',longBreak:'Long break'}
const defaults={focus:25,shortBreak:5,longBreak:15,longBreakEvery:4,bell:false}
let settings={...defaults,...readPref<Partial<typeof defaults>>('pomodoro',{})}
let phase:keyof typeof phases='focus'
let completedFocus=0,deadline=0,pausedRemaining=0,timer=0,transition=''
let renderDialog=()=>{}
let audio:AudioContext|undefined
let playingBell:OscillatorNode|undefined

function prepareBell(){
 if(!settings.bell)return
 try{
  audio??=new AudioContext()
  if(audio.state==='suspended')void audio.resume().catch(()=>{})
 }catch{
  // Audio is optional. The title and notification still announce the transition.
 }
}

function stopBell(){
 playingBell?.stop()
 playingBell=undefined
}

function ringBell(){
 if(!settings.bell||audio?.state!=='running')return
 stopBell()
 const oscillator=audio.createOscillator(),volume=audio.createGain()
 const now=audio.currentTime,interval=2,duration=10,decay=0.28
 oscillator.frequency.setValueAtTime(880,now)
 for(let offset=0;offset<=duration;offset+=interval){
  const start=now+offset
  volume.gain.setValueAtTime(0.12,start)
  volume.gain.exponentialRampToValueAtTime(0.001,start+decay)
  volume.gain.setValueAtTime(0,start+decay+0.001)
 }
 oscillator.connect(volume)
 volume.connect(audio.destination)
 oscillator.onended=()=>{
  if(playingBell===oscillator)playingBell=undefined
  oscillator.disconnect();volume.disconnect()
 }
 oscillator.start(now)
 oscillator.stop(now+duration+decay)
 playingBell=oscillator
}

function remaining(){
 const milliseconds=deadline?deadline-Date.now():pausedRemaining||settings[phase]*60000
 const seconds=Math.max(0,Math.ceil(milliseconds/1000))
 return Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')
}

function drawPlayback(control:HTMLButtonElement,compact=false){
 const label=pausedRemaining?'Resume':'Pause'
 const title=label+' timer'
 if(control.title===title)return
 control.title=title
 control.setAttribute('aria-label',title)
 control.replaceChildren(glyph(pausedRemaining?'play':'pause'))
 if(!compact)control.append(label)
}

function drawClock(){
 const active=!!(deadline||pausedRemaining)
 el('pivot-brand').hidden=active||!!transition
 el('pomodoro-mini').hidden=!(active||transition)
 const header=el('pomodoro-header')
 header.classList.toggle('pomodoro-ready',!!transition)
 el('pomodoro-label').textContent=transition||phases[phase]+(pausedRemaining?' paused':'')
 const time=el('pomodoro-time')
 time.hidden=!active
 time.textContent=remaining()
 const playback=el<HTMLButtonElement>('pomodoro-playback')
 playback.hidden=!active
 if(active)drawPlayback(playback,true)
 else if(document.activeElement===playback)header.focus()
 renderDialog()
}

function runCountdown(milliseconds:number){
 prepareBell()
 pausedRemaining=0
 deadline=Date.now()+milliseconds
 timer=window.setInterval(tick,250)
}

function togglePlayback(){
 if(deadline){
  const remaining=deadline-Date.now()
  if(remaining<=0){tick();return}
  pausedRemaining=remaining
  deadline=0
  clearInterval(timer)
 }else if(pausedRemaining)runCountdown(pausedRemaining)
 drawClock()
}

function tick(){
 if(deadline&&Date.now()>=deadline){
  deadline=0
  clearInterval(timer)
  if(phase==='focus'){
   completedFocus=settings.longBreakEvery?completedFocus+1:0
   const longBreak=!!settings.longBreakEvery&&completedFocus>=settings.longBreakEvery
   phase=longBreak?'longBreak':'shortBreak'
   if(longBreak)completedFocus=0
  }else phase='focus'
  transition=phase==='focus'?'Time to work!':phase==='longBreak'?'Time for a long break!':'Time for a short break!'
  message(transition)
  ringBell()
 }
 drawClock()
}

function settingsForm(onSave:()=>void){
 const form=node('form','','pomodoro-settings')
 form.id='pomodoro-settings'
 form.hidden=true
 const numberField=(label:string,key:'focus'|'shortBreak'|'longBreak'|'longBreakEvery',min:number,max:number)=>{
  const row=node('label',label),input=node('input')
  input.type='number';input.required=true
  input.min=String(min);input.max=String(max);input.step='1'
  input.value=String(settings[key])
  row.append(input);form.append(row)
  return input
 }
 const focus=numberField('Focus (min)','focus',1,180)
 const shortBreak=numberField('Short break (min)','shortBreak',1,180)
 const longBreak=numberField('Long break (min)','longBreak',1,180)
 const longBreakEvery=numberField('Focus sessions per long break (0 = off)','longBreakEvery',0,20)
 const bell=node('input'),bellLabel=node('label','','pomodoro-bell')
 bell.type='checkbox';bell.checked=settings.bell
 bellLabel.append(bell,'Ring when the timer ends')
 const save=node('button','Save settings','plain-action')
 save.type='submit'
 form.append(bellLabel,save)
 form.onsubmit=event=>{
  event.preventDefault()
  const longBreakInterval=longBreakEvery.valueAsNumber
  if(!longBreakInterval||!settings.longBreakEvery)completedFocus=0
  settings={
   focus:focus.valueAsNumber,shortBreak:shortBreak.valueAsNumber,longBreak:longBreak.valueAsNumber,
   longBreakEvery:longBreakInterval,bell:bell.checked,
  }
  pref('pomodoro',settings)
  if(!settings.bell)stopBell()
  prepareBell()
  onSave()
 }
 return {form,focus}
}

export function pomodoro(){
 modal('Pomodoro')
 const time=node('output','','break-clock')
 const status=node('p','','hint')
 const start=button('',()=>{
  if(deadline||pausedRemaining)return
  stopBell()
  transition=''
  runCountdown(settings[phase]*60000)
  close();drawClock()
  message(phases[phase]+' timer started.')
 },'plain-action')
 const playback=button('',togglePlayback,'plain-action')
 const row=node('div','','pomodoro-clock')
 const options=button('',()=>{
  setSettingsOpen(form.hidden)
  if(!form.hidden)focus.focus()
 },'plain-action')
 options.title='Pomodoro settings'
 options.setAttribute('aria-label',options.title)
 options.setAttribute('aria-controls','pomodoro-settings')
 options.append(glyph('settings'))
 const {form,focus}=settingsForm(()=>{
  setSettingsOpen(false)
  drawClock()
  options.focus()
 })
 function setSettingsOpen(open:boolean){
  form.hidden=!open
  options.setAttribute('aria-expanded',String(open))
 }
 const actions=node('div','','pomodoro-actions')
 const reset=button('Reset',()=>{
  clearInterval(timer)
  stopBell()
  deadline=0;pausedRemaining=0;phase='focus';completedFocus=0;transition=''
  drawClock()
  start.focus()
 },'plain-action')
 reset.title='Reset to the start of a focus session'
 actions.append(start,playback,reset)
 setSettingsOpen(false)
 renderDialog=()=>{
  if(!dialog.open||!time.isConnected){renderDialog=()=>{};return}
  const active=!!(deadline||pausedRemaining)
  time.textContent=remaining()
  status.textContent=transition||phases[phase]+(pausedRemaining?' paused':deadline?' in progress':'')
  start.hidden=active
  start.textContent='Start '+settings[phase]+'-minute '+phases[phase].toLowerCase()
  playback.hidden=!active
  if(active)drawPlayback(playback)
  else if(document.activeElement===playback)start.focus()
  reset.disabled=!(active||transition)
 }
 row.append(time,options)
 content.append(row,status,actions,form)
 drawClock()
}

el('pomodoro-header').onclick=pomodoro
el<HTMLButtonElement>('pomodoro-playback').onclick=togglePlayback
