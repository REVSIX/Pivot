import type { Capture } from './model.ts'

type V = number[]
export type Camera = {mode:'2d'|'3d'; yaw:number; pitch:number; zoom:number; panX:number; panY:number}
export const createCamera = (mode:Camera['mode']='3d'):Camera => ({mode,yaw:0.43,pitch:0.19,zoom:1,panX:0,panY:0})
export function bindCamera(c:HTMLCanvasElement,cam:Camera,draw:()=>void) {
  let drag:{id:number;x:number;y:number;pan:boolean}|undefined
  const down=(e:PointerEvent)=>{if(e.button>2)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,pan:e.button!==0||e.shiftKey||cam.mode==='2d'};c.setPointerCapture(e.pointerId)}
  const move=(e:PointerEvent)=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y
    drag.x=e.clientX;drag.y=e.clientY
    if(drag.pan){cam.panX+=dx;cam.panY+=dy}else{cam.yaw-=dx*.008;cam.pitch=Math.max(-.1,Math.min(1.35,cam.pitch+dy*.008))}
    draw()}
  const up=()=>{drag=undefined}
  const wheel=(e:WheelEvent)=>{e.preventDefault();cam.zoom=Math.max(.24,Math.min(5,cam.zoom*Math.exp(-e.deltaY*.0012)));draw()}
  const context=(e:Event)=>e.preventDefault()
  c.style.touchAction='none';c.addEventListener('pointerdown',down);c.addEventListener('pointermove',move);c.addEventListener('lostpointercapture',up)
  c.addEventListener('wheel',wheel,{passive:false});c.addEventListener('contextmenu',context)
  return ()=>{c.removeEventListener('pointerdown',down);c.removeEventListener('pointermove',move);c.removeEventListener('lostpointercapture',up);c.removeEventListener('wheel',wheel);c.removeEventListener('contextmenu',context)}
}
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
const sub=(a:V,b:V)=>a.map((v,i)=>v-b[i])
const add=(a:V,b:V)=>a.map((v,i)=>v+b[i])
const mul=(a:V,k:number)=>a.map(v=>v*k)
const cross=(a:V,b:V)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
function rot(q:V,v:V){const u=q.slice(1),uv=cross(u,v);return add(v,mul(add(mul(uv,q[0]),cross(u,uv)),2))}
type Mesh = {body:number; rotationBody?:number; tintBody?:number; faces:V[][]; shade:number}
function rings(profiles:number[][],sides=14){
  const verts=profiles.map(([r,z])=>Array.from({length:sides},(_,i)=>[r*Math.cos(i*Math.PI*2/sides),r*Math.sin(i*Math.PI*2/sides),z]))
  const faces:V[][]=[]
  for(let j=0;j<verts.length-1;j++)for(let i=0;i<sides;i++)faces.push([verts[j][i],verts[j][(i+1)%sides],verts[j+1][(i+1)%sides],verts[j+1][i]])
  return faces
}
function primitive(type:string,size:V):V[][]{
  const [r,h]=size
  if(type==='box'){
    const v=Array.from({length:8},(_,i)=>size.map((s,j)=>s*(i&(1<<j)?1:-1)))
    return [[0,4,6,2],[1,3,7,5],[0,1,5,4],[2,6,7,3],[0,2,3,1],[4,5,7,6]].map(f=>f.map(i=>v[i]))
  }
  if(type==='plane')return []
  if(type==='cylinder')return rings([[0,-h],[r,-h],[r,h],[0,h]])
  const capsule=type==='capsule', profiles:number[][]=[]
  for(let j=0;j<=8;j++){
    const a=-Math.PI/2+j*Math.PI/8
    profiles.push([r*Math.cos(a),r*Math.sin(a)+(capsule?(j<=4?-h:h):0)])
    if(j===4&&capsule)profiles.push([r,h])
  }
  const faces=rings(profiles)
  return type==='ellipsoid'?faces.map(face=>face.map(([x,y,z])=>[x,y*size[1]/r,z*size[2]/r])):faces
}
type Shape = {meshes:Mesh[]; center:V; radius:number; floor:number}
const shapes=new WeakMap<Capture,Shape>()
function shape(run:Capture):Shape {
  let cached=shapes.get(run)
  if(cached)return cached
  const f=run.frames[0],points=f.xyz??f.p.map(([x,z])=>[x,0,z])
  const mins=[0,1,2].map(i=>Math.min(...points.map(v=>v[i]))),maxs=[0,1,2].map(i=>Math.max(...points.map(v=>v[i])))
  const radius=Math.max(.25,Math.hypot(...sub(maxs,mins))*.55)
  const meshes:Mesh[]=(run.geoms??[]).map(geom=>({
    body:geom.body,shade:1,faces:primitive(geom.type,geom.size).map(face=>face.map(v=>add(rot(geom.quat,v),geom.pos)))
  }))
  // Bearing faces identify the actual body origins. Native geoms retain their MJCF dimensions.
  const bearing=Math.max(radius*.093,.015)
  for(const [i,node] of run.nodes.entries()){
    const q=[Math.SQRT1_2,Math.SQRT1_2,0,0]
    const rotationBody=i<(f.quat?.length??0)?i:node.parent
    for(const [width,height,tone] of [[1,.74,.85],[.76,.81,.38],[.43,.85,1.28]]){
      const b=width*bearing,z=height*bearing
      meshes.push({body:i,rotationBody,tintBody:Math.max(0,node.parent),shade:tone,faces:rings([[0,-z],[b*.91,-z],[b,-z*.92],[b,z*.92],[b*.91,z],[0,z]],20)
        .map(face=>face.map(v=>rot(q,v)))})
    }
  }
  cached={meshes,center:mul(add(mins,maxs),.5),radius,floor:mins[2]-radius*.18}
  shapes.set(run,cached)
  return cached
}
export function color(token:string,fallback:string) {
  return getComputedStyle(document.documentElement).getPropertyValue(token).trim()||fallback
}
function rgb(hex:string){
  const n=Number.parseInt(hex.slice(1),16)
  return hex.startsWith('#')&&hex.length===7?[n>>16,(n>>8)&255,n&255]:[160,155,210]
}
const shade=(c:V,f:number)=>'rgb('+c.map(v=>Math.round(Math.min(255,Math.max(0,v*f)))).join(',')+')'
export function drawView(g:CanvasRenderingContext2D,w:number,h:number,run:Capture,index:number,cam:Camera,trace:boolean){
  const {radius:r,center,floor,meshes}=shape(run), f=run.frames[index]
  const pos=f.xyz??f.p.map(([x,z])=>[x,0,z])
  const yaw=cam.mode==='2d'?0:cam.yaw,pitch=cam.mode==='2d'?0:cam.pitch
  const right=[Math.cos(yaw),-Math.sin(yaw),0],eye=[Math.sin(yaw)*Math.cos(pitch),Math.cos(yaw)*Math.cos(pitch),Math.sin(pitch)]
  const up=cross(right,eye), distance=3.85*r,scale=Math.min(w*.44,h*.39)/r*cam.zoom
  const project=(p:V):V=>{const rel=sub(p,center),z=dot(rel,eye),k=cam.mode==='3d'?distance/Math.max(distance*.16,distance-z):1
    return [w*.5+cam.panX+scale*k*dot(rel,right),h*.5+cam.panY-scale*k*dot(rel,up),z]}
  const poly=(vs:V[],fill:string,seams=false)=>{g.beginPath();vs.forEach(([x,y],i)=>{if(i)g.lineTo(x,y);else g.moveTo(x,y)});g.closePath();g.fillStyle=fill;g.fill();if(seams){g.strokeStyle=fill;g.lineWidth=.5;g.stroke()}}
  const panel=color('--bg','#131421'), floorA=rgb(color('--surface','#242639')),floorB=rgb(color('--panel','#202233'))
  const palette=[rgb(color('--trace-a','#c198ee')),rgb(color('--trace-b','#79d7d5'))]
  g.fillStyle=panel;g.fillRect(0,0,w,h)
  if(cam.mode==='3d'){
    const c=r*.62
    for(let j=-7;j<8;j++)for(let i=-7;i<8;i++){
      const points=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([x,y])=>[center[0]+x*c,center[1]+y*c,floor])
      if(points.some(p=>dot(sub(p,center),eye)>distance*.81))continue
      poly(points.map(project),shade((i+j)%2===0?floorA:floorB,Math.max(.55,1-.055*Math.hypot(i,j))))
    }
  }else{
    g.strokeStyle=color('--grid','#2e3145');g.lineWidth=.65;g.beginPath()
    const n=scale*r*.4
    for(let x=((w/2+cam.panX)%n+n)%n;x<w;x+=n){g.moveTo(x,0);g.lineTo(x,h)}
    for(let y=((h/2+cam.panY)%n+n)%n;y<h;y+=n){g.moveTo(0,y);g.lineTo(w,y)}
    g.stroke()
  }
  if(trace){g.strokeStyle=shade(palette[1],.72);g.lineWidth=1;g.beginPath()
    run.frames.forEach((frame,i)=>{const p=frame.xyz?.at(-1)??[frame.p.at(-1)![0],0,frame.p.at(-1)![1]]
      const [x,y]=project(p);if(i===0)g.moveTo(x,y);else g.lineTo(x,y)});g.stroke()}
  if(cam.mode==='3d'){
    g.lineCap='round';g.strokeStyle='rgba(7,8,15,.38)';g.lineWidth=Math.max(2,scale*r*.07)
    run.nodes.forEach((node,i)=>{if(node.parent<0)return
      const shadow=(v:V)=>project([v[0]+.42*(v[2]-floor),v[1]-.22*(v[2]-floor),floor+.001])
      const a=shadow(pos[i]),b=shadow(pos[node.parent]);g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke()})
  }
  const faces:{screen:V[];depth:number;fill:string}[]=[]
  for(const mesh of meshes){
    const local=mesh.body>=0,origin=local?pos[mesh.body]:[0,0,0],q=local?f.quat?.[mesh.rotationBody??mesh.body]:undefined
    if(!origin)continue
    const ink=palette[Math.max(0,mesh.tintBody??mesh.body)%2]
    for(const face of mesh.faces){
      const world=face.map(v=>add(q?rot(q,v):v,origin)), screen=world.map(project)
      const normal=cross(sub(world[2],world[0]),sub(world[3],world[1]))
      const length=Math.hypot(...normal)
      if(length<1e-12)continue
      const unit=mul(normal,1/length)
      if(dot(unit,eye)<-.08)continue
      const light=.57+.48*Math.max(0,dot(unit,[-.45,.51,.73]))
      faces.push({screen,depth:screen.reduce((s,p)=>s+p[2],0)/screen.length,fill:shade(ink,light*mesh.shade)})
    }
  }
  faces.sort((a,b)=>a.depth-b.depth);for(const face of faces)poly(face.screen,face.fill,true)
  // Historical captures without compiled primitive metadata still show a body skeleton.
  if(!meshes.length){g.lineCap='round';g.lineWidth=5;run.nodes.forEach((n,i)=>{if(n.parent<0)return
    const a=project(pos[i]),b=project(pos[n.parent]);g.strokeStyle=shade(palette[n.parent%2],1)
    g.beginPath();g.moveTo(a[0],a[1]);g.lineTo(b[0],b[1]);g.stroke()})}
  g.lineCap='round';g.lineWidth=1.4;g.font='9px monospace'
  const axes=[['X','#e8859a',[1,0,0]],['Y','#90c48c',[0,1,0]],['Z','#9b9ff7',[0,0,1]]] as const
  for(const [label,col,axis] of axes){const a=Array.from(axis),x=31+dot(a,right)*18,y=h-24-dot(a,up)*18
    g.beginPath();g.strokeStyle=col;g.moveTo(31,h-24);g.lineTo(x,y);g.stroke();g.fillStyle=col;g.fillText(label,x+2,y)}
}
