export type Frame = { t: number; q: number[]; v: number[]; p: number[][]; xyz?: number[][]; quat?: number[][]; actuatorForce?: number[]; ctrl?: number[] }
export interface Capture {
  title: string
  engine: string
  dt: number
  integrator: string
  nodes: { name: string; parent: number }[]
  joints: { name: string; unit: string }[]
  actuators?: {name:string; unit:string}[]
  geoms?: {type:string; body:number; pos:number[]; quat:number[]; size:number[]}[]
  source?: {script?:string;model?:string}
  control?: 'passive'
  frames: Frame[]
}

export function clipCapture(capture:Capture):Capture {
  let previous=0,time=0
  let interval=Number.isFinite(capture.dt)?Math.max(.001,capture.dt):.025
  const frames=capture.frames.map((frame,index)=>{
    if(index===0)time=Number.isFinite(frame.t)?Math.max(0,frame.t):0
    else{
      const delta=frame.t-previous
      // Training can reset MuJoCo time between episodes within the same recording.
      if(Number.isFinite(delta)&&delta>0)interval=Math.max(.001,delta)
      time+=interval
    }
    previous=frame.t
    return {...frame,t:time}
  })
  return {...capture,frames}
}

export function mediaFilename(capture:Capture|undefined,selectedModel:string,extension:string){
  for(const path of [capture?.source?.script,capture?.source?.model,selectedModel]){
    const name=path?.split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/,'').replace(/[<>:"|?*\u0000-\u001f]/g,'-').trim()
    if(name)return name+'.'+extension
  }
  return 'simulation.'+extension
}
export interface Project {
  folder: string
  rootName: string
  files: string[]
  folders: string[]
  truncated: boolean
  git: { branch: string; changed: number } | null
  demo: boolean
}
export function csv(run: Capture) {
  const fields = run.joints.flatMap((_, i) => ['/Sim/qpos/' + i, '/Sim/qvel/' + i])
  return (
    [
      ['Timestamp', ...fields].join(','),
      ...run.frames.map((frame) =>
        [frame.t, ...frame.q.flatMap((q, i) => [q, frame.v[i]])].join(','),
      ),
    ].join('\n') + '\n'
  )
}
