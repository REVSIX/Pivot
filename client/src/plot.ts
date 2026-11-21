import type { Capture } from './model.ts'
import { drawView, createCamera, color, type Camera } from './viewer.ts'
export { bindCamera, createCamera, type Camera } from './viewer.ts'
export function tint(i:number) {
  return color(i%2 ? '--trace-b' : '--trace-a', i%2 ? '#79d7d5' : '#c198ee')
}
function surface(canvas: HTMLCanvasElement) {
  const w = canvas.clientWidth,
    h = canvas.clientHeight
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
    canvas.width = Math.round(w * ratio)
    canvas.height = Math.round(h * ratio)
  }
  const g = canvas.getContext('2d')!
  g.setTransform(ratio, 0, 0, ratio, 0, 0)
  g.clearRect(0, 0, w, h)
  return { g, w, h }
}
export function scene(canvas:HTMLCanvasElement,run:Capture,index:number,trace:boolean,camera:Camera=createCamera(),showOrigins=false) {
  const {g,w,h}=surface(canvas)
  if(w && h && run.frames[index])drawView(g,w,h,run,index,camera,trace,showOrigins)
}
export function graph(
  canvas: HTMLCanvasElement,
  run: Capture,
  joint: number,
  index: number,
  large = false,
  velocity = false,
) {
  const { g, w, h } = surface(canvas)
  if (!w || !h) return
  const field = velocity ? 'v' : 'q'
  const limit = Math.max(0.01, ...run.frames.map((frame) => Math.abs(frame[field][joint])))
  const x = (i: number) => 2 + ((w - 4) * i) / Math.max(1,run.frames.length - 1)
  const y = (v: number) => h / 2 - (v / limit) * (h / 2 - 3)
  g.strokeStyle = color('--grid','#353644')
  g.lineWidth = 1
  g.beginPath()
  g.moveTo(0, h / 2)
  g.lineTo(w, h / 2)
  g.stroke()
  if (large) {
    g.setLineDash([2, 6])
    for (let i = 0; i < 9; i++) {
      g.beginPath()
      g.moveTo((w * i) / 8, 0)
      g.lineTo((w * i) / 8, h)
      g.stroke()
    }
    g.setLineDash([])
  }
  g.strokeStyle = tint(joint)
  g.lineWidth = large ? 1.8 : 1.2
  g.beginPath()
  run.frames.forEach((f, i) => {
    if (!i) g.moveTo(x(i), y(f[field][joint]))
    else g.lineTo(x(i), y(f[field][joint]))
  })
  g.stroke()
  const cx = x(index),
    cy = y(run.frames[index][field][joint])
  if (large) {
    g.strokeStyle = color('--accent','#e7b86b')
    g.beginPath()
    g.moveTo(cx, 0)
    g.lineTo(cx, h)
    g.stroke()
  }
  g.beginPath()
  g.arc(cx, cy, large ? 3.5 : 2, 0, Math.PI * 2)
  g.fillStyle = tint(joint)
  g.fill()
}
