import type { Capture } from './model.ts'
const ink = ['#bb9af7', '#81bdb5', '#e7b86b', '#7aa2f7']
export function tint(i: number) {
  return ink[i % ink.length]
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
type Extents = { xmin: number; xmax: number; zmin: number; zmax: number }
const bounds = new WeakMap<Capture, Extents>()
function extents(run: Capture) {
  let e = bounds.get(run)
  if (!e) {
    e = { xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity }
    for (const f of run.frames)
      for (const [x, z] of f.p) {
        e.xmin = Math.min(e.xmin, x)
        e.xmax = Math.max(e.xmax, x)
        e.zmin = Math.min(e.zmin, z)
        e.zmax = Math.max(e.zmax, z)
      }
    bounds.set(run, e)
  }
  return e
}
export function scene(canvas: HTMLCanvasElement, run: Capture, index: number, trace: boolean) {
  const { g, w, h } = surface(canvas)
  if (!w || !h) return
  const e = extents(run),
    f = run.frames[index]
  const scale = Math.min(
    (w - 78) / Math.max(0.2, e.xmax - e.xmin),
    (h - 105) / Math.max(0.2, e.zmax - e.zmin),
  )
  const px = (x: number) => w / 2 + (x - (e.xmin + e.xmax) / 2) * scale
  const pz = (z: number) => h / 2 - (z - (e.zmin + e.zmax) / 2) * scale
  function line(x: number, y: number, a: number, b: number, color: string, width = 1) {
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(a, b)
    g.strokeStyle = color
    g.lineWidth = width
    g.stroke()
  }
  function ring(x: number, y: number, r: number, fill: string, stroke: string, width = 1) {
    g.beginPath()
    g.arc(x, y, r, 0, Math.PI * 2)
    g.fillStyle = fill
    g.fill()
    g.strokeStyle = stroke
    g.lineWidth = width
    g.stroke()
  }
  g.font = '10px "IBM Plex Mono", monospace'
  for (let x = 24; x < w - 10; x += 32)
    for (let y = 24; y < h - 14; y += 32) {
      g.fillStyle = '#343543'
      g.fillRect(x, y, 1.4, 1.4)
    }
  const root = f.p[0],
    ox = px(root[0]),
    oy = pz(root[1])
  g.setLineDash([3, 6])
  line(ox, 42, ox, h - 38, '#343542')
  line(20, oy, w - 20, oy, '#2c2e3a')
  g.setLineDash([])
  if (trace && f.p.length > 1) {
    const last = f.p.length - 1
    g.beginPath()
    run.frames.forEach((frame, i) => {
      const [x, z] = frame.p[last]
      if (i === 0) g.moveTo(px(x), pz(z))
      else g.lineTo(px(x), pz(z))
    })
    g.strokeStyle = 'rgba(136,178,174,.31)'
    g.lineWidth = 1
    g.stroke()
  }
  const r = Math.max(7, Math.min(13, w / 52))
  // Fixed roots get a sectioned mounting plate in the projection.
  if (run.frames.every((frame) => frame.p[0][0] === root[0] && frame.p[0][1] === root[1])) {
    line(ox - 25, oy - r - 3, ox + 25, oy - r - 3, '#818397', 1.4)
    for (let dx = -24; dx < 23; dx += 6) line(ox + dx, oy - r - 3, ox + dx + 5, oy - r - 9, '#555769')
    line(ox, oy - r - 3, ox, oy, '#818397', 2)
  }
  for (let i = 0; i < run.nodes.length; i++) {
    const parent = run.nodes[i].parent
    if (parent < 0) continue
    const [a, b] = f.p[parent],
      [c, d] = f.p[i]
    const x = px(a),
      y = pz(b),
      x2 = px(c),
      y2 = pz(d)
    if (Math.hypot(x - x2, y - y2) < 1) continue
    const color = tint(parent)
    g.lineCap = 'round'
    line(x, y, x2, y2, color, r * 2)
    line(x, y, x2, y2, '#272634', r * 2 - 3)
    line(
      x + (x2 - x) * 0.19,
      y + (y2 - y) * 0.19,
      x2 + (x - x2) * 0.19,
      y2 + (y - y2) * 0.19,
      color,
      2,
    )
    g.lineCap = 'butt'
  }
  for (let i = 0; i < run.nodes.length; i++) {
    const [x, z] = f.p[i],
      a = px(x),
      b = pz(z)
    const color = tint(Math.max(0, run.nodes[i].parent))
    ring(a, b, r + 1, '#20212c', color, 2)
    ring(a, b, r * 0.47, '#242532', color, 1.5)
    ring(a, b, 2, color, color)
    if (i === 0 || i === f.p.length - 1) {
      const parent = run.nodes[i].parent
      const left = a > w * 0.75 || (parent >= 0 && x < f.p[parent][0]),
        sign = left ? -1 : 1
      line(a + sign * (r + 3), b - 3, a + sign * 26, b - 15, '#696b80')
      line(a + sign * 26, b - 15, a + sign * 47, b - 15, '#696b80')
      g.fillStyle = '#a7a9bd'
      g.textAlign = left ? 'right' : 'left'
      g.fillText(run.nodes[i].name, a + sign * 30, b - 21)
    }
  }
  g.textAlign = 'left'
  const axisX = 28,
    axisY = h - 50
  line(axisX, axisY, axisX + 17, axisY, '#76788b')
  line(axisX, axisY, axisX, axisY - 17, '#76788b')
  g.fillStyle = '#8c8fa4'
  g.fillText('x', axisX + 20, axisY + 3)
  g.fillText('z', axisX - 3, axisY - 22)
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
  const x = (i: number) => 2 + ((w - 4) * i) / (run.frames.length - 1)
  const y = (v: number) => h / 2 - (v / limit) * (h / 2 - 3)
  g.strokeStyle = '#353644'
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
    g.strokeStyle = '#e7b86b'
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
