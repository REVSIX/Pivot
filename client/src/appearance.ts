import { isPalette, isTheme, themes, type Palette } from '../../shared/theme.ts'
import { api, button, close, content, message, modal, node, pref, promptText, readPref, run, type Action } from './ui.ts'

const names={tokyo:'Tokyo Night',nord:'Nord',gruvbox:'Gruvbox',rose:'Rosé Pine'}
type Colors={bg:string;main:string;caret:string;sub:string;subAlt:string;text:string;error:string}
type Catalog=Record<string,Colors>
type SavedPalette={name:string;colors:Palette}
const root=document.documentElement

function hex(value:string, background='#141520'){
 const raw=value.slice(1)
 const full=raw.length<5?[...raw].map(char=>char+char).join(''):raw
 return full.length===8?mix(background,'#'+full.slice(0,6),parseInt(full.slice(6),16)/255):'#'+full
}

function mix(background:string,foreground:string,amount:number){
 return '#'+[1,3,5].map(index=>{
  const a=parseInt(background.slice(index,index+2),16),b=parseInt(foreground.slice(index,index+2),16)
  return Math.round(a+(b-a)*amount).toString(16).padStart(2,'0')
 }).join('')
}

function palette(colors:Colors):Palette{
 const bg=hex(colors.bg), panel=hex(colors.subAlt,bg), text=hex(colors.text,bg)
 const accent=hex(colors.main,bg), caret=hex(colors.caret,bg), muted=mix(hex(colors.sub,bg),text,.25)
 return {
  bg,panel,text,accent,muted,surface:mix(panel,text,.08),sel:mix(panel,accent,.25),line:mix(panel,text,.24),
  grid:mix(panel,text,.15),'accent-surface':mix(panel,accent,.16),'trace-a':accent,'trace-b':caret,
  green:'#91d59c',danger:hex(colors.error,bg),
 }
}

function restorePalette():SavedPalette{
 const saved=readPref<unknown>('palette',null)
 if(saved&&typeof saved==='object'&&'name' in saved&&typeof saved.name==='string'&&'colors' in saved&&isPalette(saved.colors))
  return {name:saved.name,colors:saved.colors}
 const previous=readPref('theme','tokyo')
 const name=isTheme(previous)?previous:'tokyo'
 return {name:names[name],colors:themes[name]}
}

export class Appearance {
 selected=restorePalette()
 private custom=readPref<SavedPalette[]>('customPalettes',[]).filter(item=>typeof item.name==='string'&&isPalette(item.colors))
 private catalog=readPref<Catalog>('monkeytype.palettes',{})
 private catalogRequest?:Promise<void>
 constructor(private readonly changed:(colors:Palette,preview:boolean)=>void){}

 private render(colors:Palette,preview=false){
  for(const [key,color] of Object.entries(colors))root.style.setProperty('--'+key,color)
  const bg=colors.bg
  const brightness=[1,3,5].reduce((sum,i)=>sum+parseInt(bg.slice(i,i+2),16),0)
  root.style.colorScheme=brightness>430?'light':'dark'
  this.changed(colors,preview)
 }

 apply(){
  root.dataset.translucent=String(readPref('translucent',false))
  root.style.setProperty('--panel-opacity',(100-readPref('translucencyPercent',20))+'%')
  root.dataset.ambient=String(readPref('ambient',false))
  const image=readPref('background','')
  root.style.setProperty('--background-image',/^data:image\/(png|jpeg|webp|gif);base64,[a-z\d+/=]+$/i.test(image)?'url("'+image+'")':'none')
  this.render(this.selected.colors)
 }

 resetPreview(){this.render(this.selected.colors)}

 private select(name:string,colors:Palette){
  this.selected={name,colors};pref('palette',this.selected);this.apply()
 }

 themeActions():Action[]{
  const action=(name:string,colors:Palette,source='Theme'):Action=>({
   label:name,key:this.selected.name===name?'Active':source,
   do:()=>this.select(name,colors),preview:()=>this.render(colors,true),
  })
  return [
   ...Object.entries(themes).map(([key,colors])=>action(names[key as keyof typeof names],colors)),
   ...this.custom.map(({name,colors})=>action(name,colors,'Custom')),
   ...Object.entries(this.catalog).sort(([a],[b])=>a.localeCompare(b)).map(([id,colors])=>
    action(id.replaceAll('_',' '),palette(colors),'Monkeytype')),
  ]
 }

 loadCatalog(){
  return this.catalogRequest??=api<Catalog>('themes/monkeytype').then(catalog=>{
   this.catalog=catalog
   pref('monkeytype.palettes',catalog)
  }).catch(()=>{this.catalogRequest=undefined})
 }

 customize(){
  modal('Customize palette')
  const form=node('form'),name=node('input','','query')
  name.placeholder='Palette name';name.setAttribute('aria-label','Palette name');name.value='Custom'
  form.append(name)
  const inputs=Object.entries(this.selected.colors).map(([key,color])=>{
   const input=node('input');input.type='color';input.value=color
   const row=node('label','','variable-row');row.append(key,input);form.append(row)
   return [key,input] as const
  })
  form.append(node('button','Save palette','plain-action'));content.append(form)
  form.onsubmit=event=>{
   event.preventDefault()
   const colors=Object.fromEntries(inputs.map(([key,input])=>[key,input.value]))
   if(isPalette(colors))run(()=>{
    const label=name.value.trim()||'Custom'
    this.custom=[...this.custom.filter(item=>item.name!==label),{name:label,colors}]
    pref('customPalettes',this.custom)
    this.select(label,colors);close()
   })
  }
 }

 translucencyActions():Action[]{
  const percent=readPref('translucencyPercent',20)
  const actions:Action[]=[{label:'Panel translucency (%)',key:percent+'%',do:()=>this.translucency(percent)}]
  if(readPref('translucent',false))actions.push({label:'Use solid panels',do:()=>{pref('translucent',false);this.apply()}})
  return actions
 }

 private translucency(percent:number){
  promptText('Panel translucency','Translucency from 0 to 100%',String(percent),value=>{
   const input=value.replace(/\s*%$/,'')
   const amount=Number(input)
   if(!/^\d+$/.test(input)||amount>100)throw new Error('Enter a whole percentage from 0 to 100.')
   pref('translucencyPercent',amount)
   pref('translucent',amount>0)
   this.apply()
  })
 }

 background(){
  modal('Workspace background')
  const picker=node('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,image/gif';picker.setAttribute('aria-label','Background image')
  picker.onchange=()=>{
   const file=picker.files?.[0]
   if(!file)return
   if(!/^image\/(png|jpeg|webp|gif)$/.test(file.type)||file.size>2*1024*1024){message('Choose a PNG, JPEG, WebP or GIF up to 2 MB.');return}
   const reader=new FileReader()
   reader.onload=()=>run(()=>{pref('background',reader.result);pref('translucent',true);this.apply();close()})
   reader.onerror=()=>message('Could not read the background image.')
   reader.readAsDataURL(file)
  }
  content.append(picker,button('Remove background image',()=>{pref('background','');this.apply();close()}),
   button(readPref('ambient',false)?'Disable ambient animation':'Enable ambient animation',()=>{
    const enable=!readPref('ambient',false)
    pref('ambient',enable);if(enable)pref('translucent',true)
    this.apply();close()
   }))
 }
}
