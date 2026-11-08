import './style.css'
import { icon } from './icons.ts'
import { scene, graph, tint } from './plot.ts'
import { csv, type Capture, type Project } from './model.ts'

function el<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T
}
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', cls = '') {
  const n = document.createElement(tag)
  n.textContent = text
  n.className = cls
  return n
}
function button(label: string, fn: () => void, cls = 'choice') {
  const b = node('button', label, cls)
  b.onclick = fn
  return b
}
function action(id: string, label: string, glyph: string) {
  el(id).replaceChildren()
  el(id).insertAdjacentHTML('beforeend', icon(glyph))
  el(id).append(document.createTextNode(label))
}
type View = 'simulation' | 'editor' | 'telemetry'
let token = '',
  project: Project,
  file = '',
  run: Capture | undefined,
  view: View = 'simulation',
  index = 0
let playing = false,
  speed = 1,
  trace = true,
  origin = '',
  busy = false,
  generation = 0
let editor: { focus: () => void } | undefined,
  startingEditor = false
let currentProjectRequest = 0,
  dialogGeneration = 0,
  playbackHandle = 0
const dialog = el<HTMLDialogElement>('dialog'),
  body = el('dialog-body')
const primary = el<HTMLButtonElement>('primary'),
  range = el<HTMLInputElement>('scrub')
function say(s: string) {
  el('notice').textContent = s
}
async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'X-Hinge-Token': token, ...options.headers },
  })
  if (!res.ok)
    throw new Error(
      (await res.json().catch(() => ({}))).error || 'Request failed (' + res.status + ').',
    )
  return res.json()
}
function report(error: unknown) {
  say(error instanceof Error ? error.message : String(error))
}
function modal(title: string) {
  dialogGeneration++
  el('dialog-title').textContent = title
  body.replaceChildren()
  if (!dialog.open) dialog.showModal()
}
function close() {
  if (dialog.open) dialog.close()
  dialogGeneration++
}
function leaf(p: Project) {
  return p.folder === '.' ? p.rootName : p.folder.split('/').at(-1)!
}
async function openProject(folder: string) {
  if (editor || startingEditor) {
    say('Exit LazyVim with :qa before switching folders.')
    return
  }
  const request = ++currentProjectRequest
  const next = await api<Project>('/api/project?folder=' + encodeURIComponent(folder))
  let capture: Capture | undefined
  if (next.demo) {
    const response = await fetch('/pendulum.capture.json')
    if (!response.ok) throw new Error('Bundled reference capture is unavailable.')
    capture = await response.json()
  }
  if (request !== currentProjectRequest) return
  generation++
  stop()
  project = next
  run = capture
  origin = capture ? 'reference capture' : ''
  file = (capture ? 'pendulum.xml' : next.files.find((f) => f.toLowerCase().endsWith('.xml'))) || ''
  index = 0
  el('project-label').textContent = leaf(project)
  close()
  say('')
  render()
}
function stop() {
  playing = false
  cancelAnimationFrame(playbackHandle)
  el('play').innerHTML = icon('play')
  el('play').setAttribute('aria-label', 'Play capture')
}
function setView(next: View) {
  stop()
  view = next
  render()
  if (next === 'editor') editor?.focus()
}
function render() {
  for (const item of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
    if (item.dataset.view === view) item.setAttribute('aria-current', 'page')
    else item.removeAttribute('aria-current')
  }
  for (const id of ['simulation', 'telemetry', 'editor'])
    el(id).hidden = id !== view || (id !== 'editor' && !run)
  el('empty').hidden = view === 'editor' || !!run
  el('empty-text').textContent = file
    ? 'Run the selected model to inspect its motion and telemetry.'
    : 'Open a folder containing a self-contained MJCF .xml model.'
  el('context').textContent =
    view === 'editor'
      ? project.rootName + ' / ' + project.folder
      : leaf(project) + (file ? ' / ' + file : '')
  el('title').textContent =
    view === 'simulation' ? run?.title || 'simulation' : view === 'editor' ? 'workspace' : 'telemetry'
  el('transport').hidden = view === 'editor' || !run
  el('hints').hidden = view === 'editor' || !run
  el('source').textContent =
    view === 'editor'
      ? 'LazyVim / Neovim'
      : run
        ? origin + ' / ' + run.frames.length + ' samples'
        : ''
  primary.disabled =
    busy ||
    (view === 'telemetry' && !run) ||
    (view === 'simulation' && !file) ||
    (view === 'editor' && startingEditor)
  if (view === 'simulation') {
    action('primary', busy ? 'running…' : 'run model', 'run')
    primary.onclick = () => void simulate()
  }
  if (view === 'telemetry') {
    action('primary', 'export csv', 'down')
    primary.onclick = download
  }
  if (view === 'editor') {
    action('primary', editor ? 'focus editor' : 'open LazyVim', 'code')
    primary.onclick = () => void startEditor(file || undefined)
    editorList()
  }
  if (run && view !== 'editor') {
    el('engine').textContent = run.engine
    el('duration').textContent = run.frames.at(-1)!.t.toFixed(3) + ' s'
    range.max = String(run.frames.length - 1)
    if (view === 'simulation') setupInspector(run)
    else setupChannels(run)
    paint()
  }
}
function swatch(i: number) {
  const s = node('i', '', 'swatch')
  s.style.backgroundColor = tint(i)
  return s
}
function setupInspector(r: Capture) {
  const list = el('joint-list')
  list.replaceChildren()
  r.joints.forEach((j, i) => {
    const row = node('div', '', 'joint'),
      head = node('div', '', 'joint-head'),
      data = node('div', '', 'joint-data')
    head.append(swatch(i), j.name)
    const val = node('strong')
    val.id = 'val-' + i
    const spark = node('canvas')
    spark.id = 'spark-' + i
    spark.setAttribute('aria-hidden', 'true')
    data.append(val, spark)
    row.append(head, data)
    list.append(row)
  })
  el('specs').replaceChildren()
  for (const [name, value] of [
    ['integrator', r.integrator],
    ['timestep', (r.dt * 1000).toFixed(1) + ' ms'],
  ]) {
    const p = node('p')
    p.append(name, node('b', value))
    el('specs').append(p)
  }
}
function setupChannels(r: Capture) {
  el('channels').replaceChildren()
  r.joints.forEach((j, i) => {
    for (const field of ['q', 'v']) {
      const key = i + '-' + field,
        row = node('div', '', 'channel'),
        head = node('h2')
      const value = node('span')
      value.id = 'channel-' + key
      head.append(swatch(i), j.name + ' / ' + (field === 'q' ? 'position' : 'velocity'), value)
      const canvas = node('canvas')
      canvas.id = 'plot-' + key
      const ends = node('div', '', 'axis-ends')
      ends.append(node('span', '0 s'), node('span', r.frames.at(-1)!.t + ' s'))
      row.append(head, canvas, ends)
      el('channels').append(row)
    }
  })
}
function paint() {
  if (!run || view === 'editor') return
  const f = run.frames[index]
  range.value = String(index)
  range.style.setProperty('--progress', (index / (run.frames.length - 1)) * 100 + '%')
  el('clock').replaceChildren(f.t.toFixed(3) + ' ', node('small', 's'))
  if (view === 'simulation') {
    scene(el<HTMLCanvasElement>('drawing'), run, index, trace)
    run.joints.forEach((j, i) => {
      const val = el('val-' + i)
      val.replaceChildren(f.q[i].toFixed(2) + ' ', node('small', j.unit))
      graph(el<HTMLCanvasElement>('spark-' + i), run!, i, index)
    })
  } else {
    run.joints.forEach((j, i) => {
      for (const field of ['q', 'v'] as const) {
        const key = i + '-' + field
        el('channel-' + key).textContent =
          f[field][i].toFixed(3) + ' ' + j.unit + (field === 'v' ? '/s' : '')
        graph(el<HTMLCanvasElement>('plot-' + key), run!, i, index, true, field === 'v')
      }
    })
  }
}
function togglePlay() {
  if (!run || view === 'editor') return
  if (playing) {
    stop()
    return
  }
  const frames = run.frames
  if (index === frames.length - 1) index = 0
  const start = performance.now(),
    offset = frames[index].t
  playing = true
  el('play').innerHTML = icon('pause')
  el('play').setAttribute('aria-label', 'Pause capture')
  const tick = (now: number) => {
    if (!playing) return
    const t = offset + ((now - start) / 1000) * speed
    const next = Math.min(frames.length - 1, Math.floor(t / frames[1].t))
    if (index !== next) {
      index = next
      paint()
    }
    if (index === frames.length - 1) {
      stop()
      return
    }
    playbackHandle = requestAnimationFrame(tick)
  }
  playbackHandle = requestAnimationFrame(tick)
}
async function simulate() {
  if (!file || busy) return
  const revision = generation
  stop()
  busy = true
  render()
  say('Stepping ' + file + ' in MuJoCo…')
  try {
    const result = await api<Capture>('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder: project.folder, file }),
    })
    if (revision !== generation) return
    run = result
    origin = 'local run'
    index = 0
    say('')
  } catch (error) {
    report(error)
  } finally {
    busy = false
    render()
  }
}
function download() {
  if (!run) return
  const url = URL.createObjectURL(new Blob([csv(run)], { type: 'text/csv;charset=utf-8' }))
  const link = node('a')
  link.href = url
  link.download = (file || 'hinge').replace(/\.xml$/i, '') + '.csv'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1500)
  say('CSV exported for AdvantageScope.')
}
function editorList() {
  el('editor-intro').hidden = !!editor || startingEditor
  el('terminal').hidden = !el('editor-intro').hidden
  el('files').replaceChildren()
  for (const name of project.files) {
    const b = button(name, () => void startEditor(name), 'file-row')
    b.insertAdjacentHTML('afterbegin', icon('code'))
    el('files').append(b)
  }
  if (!project.files.length)
    el('files').append(node('p', 'No visible files in this folder.', 'dialog-note'))
  el('git-info').textContent = project.git
    ? project.git.branch + ' / ' + project.git.changed + ' changed'
    : 'No Git status available.'
}
async function startEditor(target?: string) {
  if (editor) {
    setView('editor')
    editor.focus()
    return
  }
  if (startingEditor) return
  view = 'editor'
  startingEditor = true
  render()
  say('Opening LazyVim…')
  try {
    const { launch } = await import('./editor.ts')
    editor = launch(el('terminal'), token, project.folder, target, (message) => {
      editor = undefined
      startingEditor = false
      el('terminal').replaceChildren()
      render()
      say(message)
      const folder = project.folder
      void api<Project>('/api/project?folder=' + encodeURIComponent(folder))
        .then((p) => {
          if (project.folder === folder) {
            project = p
            render()
          }
        })
        .catch(report)
    })
    say('')
    startingEditor = false
    render()
  } catch (error) {
    startingEditor = false
    render()
    report(error)
  }
}
async function folders(folder = project.folder) {
  modal('open folder')
  const seq = dialogGeneration
  body.append(node('p', 'Loading folders…', 'dialog-note'))
  try {
    const p = await api<Project>('/api/project?folder=' + encodeURIComponent(folder))
    if (!dialog.open || seq !== dialogGeneration) return
    body.replaceChildren(
      node('p', p.rootName + (folder === '.' ? '' : ' / ' + folder), 'dialog-note'),
    )
    body.append(
      button(
        'open this folder',
        () => {
          if (editor || startingEditor) {
            close()
            say('Exit LazyVim with :qa before switching folders.')
            return
          }
          void openProject(folder).catch(report)
        },
        'choice selected',
      ),
    )
    if (folder !== '.')
      body.append(
        button(
          '↑ parent folder',
          () => void folders(folder.split('/').slice(0, -1).join('/') || '.'),
        ),
      )
    for (const f of p.folders)
      body.append(button(f + ' /', () => void folders(folder === '.' ? f : folder + '/' + f)))
    if (p.truncated)
      body.append(node('p', 'Directory listing limited to 1,024 entries.', 'dialog-note'))
  } catch (err) {
    if (seq === dialogGeneration) {
      body.replaceChildren(node('p', String(err), 'dialog-note'))
    }
  }
}
function chooseModel() {
  modal('select model')
  const models = project.files.filter((f) => f.toLowerCase().endsWith('.xml'))
  for (const name of models)
    body.append(
      button(name, () => {
        generation++
        file = name
        run = undefined
        index = 0
        close()
        setView('simulation')
        say('')
      }),
    )
  if (!models.length) body.append(button('open model folder', () => void folders()))
}
function music() {
  if (el('player').children.length) {
    el('player').replaceChildren()
    el('player-state').textContent = 'open player'
    return
  }
  modal('Spotify player')
  const input = node('input')
  input.className = 'query'
  input.type = 'url'
  input.placeholder = 'paste a Spotify track or playlist link'
  input.setAttribute('aria-label', 'Spotify link')
  input.value = localStorage.getItem('hinge.spotify') || ''
  const note = node('p', 'Opening the player connects to Spotify.', 'dialog-note')
  const load = () => {
    try {
      const url = new URL(input.value.trim())
      const match = /^\/(?:intl-[a-z]+\/)?(track|playlist|album|episode)\/([a-zA-Z0-9]{22})\/?$/.exec(
        url.pathname,
      )
      if (url.origin !== 'https://open.spotify.com' || !match) throw Error()
      const iframe = node('iframe')
      iframe.title = 'Spotify player'
      iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'
      iframe.src = 'https://open.spotify.com/embed/' + match[1] + '/' + match[2] + '?theme=0'
      el('player').replaceChildren(iframe)
      localStorage.setItem('hinge.spotify', url.href)
      el('player-state').textContent = 'close player'
      close()
    } catch {
      note.textContent = 'Enter a full open.spotify.com track, playlist, album, or episode link.'
    }
  }
  input.onkeydown = (e) => {
    if (e.key === 'Enter') load()
  }
  body.append(input, note, button('open player', load, 'dialog-action'))
  input.focus()
}
function palette() {
  modal('commands')
  const query = node('input', '', 'query')
  query.placeholder = 'type a command…'
  query.setAttribute('aria-label', 'Search commands')
  const list = node('div')
  let active = 0
  const actions: [string, () => void][] = [
    ['open folder', () => void folders()],
    ['open LazyVim editor', () => void startEditor(file || undefined)],
    ['select model', chooseModel],
    [
      'run simulation',
      () => {
        setView('simulation')
        void simulate()
      },
    ],
    ['show simulation', () => setView('simulation')],
    ['show telemetry', () => setView('telemetry')],
    ['export AdvantageScope CSV', download],
    ['toggle Spotify player', music],
  ]
  function options() {
    return actions.filter(([name]) => name.toLowerCase().includes(query.value.toLowerCase()))
  }
  function select(fn: () => void) {
    close()
    fn()
  }
  function draw() {
    list.replaceChildren()
    options().forEach(([name, fn], i) => {
      const b = button(name, () => select(fn), 'choice' + (active === i ? ' selected' : ''))
      if (active === i) b.append(node('small', '↵'))
      list.append(b)
    })
    if (!list.children.length) list.append(node('p', 'No matching commands.', 'dialog-note'))
  }
  query.oninput = () => {
    active = 0
    draw()
  }
  query.onkeydown = (e) => {
    const opts = options()
    if (!opts.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      active = (active + opts.length + (e.key === 'ArrowDown' ? 1 : -1)) % opts.length
      draw()
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      select(opts[active][1])
    }
  }
  body.append(query, list)
  draw()
  query.focus()
}
for (const host of document.querySelectorAll<HTMLElement>('[data-icon]'))
  host.innerHTML = icon(host.dataset.icon!)
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
  b.onclick = () => {
    if (project) setView(b.dataset.view as View)
  }
el('commands').onclick = () => {
  if (project) palette()
}
el('dismiss').onclick = close
el('folder').onclick = () => {
  if (project) void folders()
}
el('spotify').onclick = music
el('play').onclick = togglePlay
el('trace').onclick = () => {
  trace = !trace
  el('trace').textContent = 'trajectory ' + (trace ? 'on' : 'off')
  el('trace').setAttribute('aria-pressed', String(trace))
  paint()
}
el('speed').onclick = () => {
  const was = playing
  stop()
  speed = speed === 1 ? 2 : speed === 2 ? 0.5 : 1
  el('speed').textContent = speed + '×'
  if (was) togglePlay()
}
range.oninput = () => {
  stop()
  index = Number(range.value)
  paint()
}
document.addEventListener(
  'keydown',
  (e) => {
    if (!project) return
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault()
      e.stopImmediatePropagation()
      if (dialog.open) close()
      else palette()
      return
    }
    if (
      dialog.open ||
      view === 'editor' ||
      e.altKey ||
      e.ctrlKey ||
      e.metaKey ||
      (e.target as HTMLElement).matches('input,textarea,[contenteditable=true]')
    )
      return
    if (e.code === 'Space') {
      if ((e.target as HTMLElement).closest('button')) return
      e.preventDefault()
      togglePlay()
    }
    if (e.key.toLowerCase() === 'r') {
      e.preventDefault()
      void simulate()
    }
  },
  true,
)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stop()
})
window.addEventListener('beforeunload', (event) => {
  if (editor) {
    event.preventDefault()
    event.returnValue = ''
  }
})
window.addEventListener('resize', paint)
document.fonts.ready.then(() => paint())
async function boot() {
  const session = await api<{ token: string; initial: string }>('/api/session')
  token = session.token
  await openProject(session.initial)
  el('connection').textContent = 'local session'
}
boot().catch((error) => {
  el('connection').textContent = 'offline'
  report(error)
})
