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
  frames: Frame[]
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
