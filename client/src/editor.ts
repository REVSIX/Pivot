import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
export function launch(
  host: HTMLElement,
  token: string,
  folder: string,
  file: string | undefined,
  onExit: (message: string) => void,
) {
  const term = new Terminal({
    fontFamily:
      '"JetBrainsMono Nerd Font Mono", "CaskaydiaCove Nerd Font Mono", "IBM Plex Mono", monospace',
    fontSize: 13,
    allowProposedApi: false,
    scrollback: 350,
    theme: { background: '#191a23', foreground: '#cdd1e1', cursor: '#e7b86b' },
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(host)
  fit.fit()
  term.attachCustomKeyEventHandler(
    (event) => !(event.ctrlKey && event.shiftKey && event.code === 'KeyP'),
  )
  const query = new URLSearchParams({ folder, ...(file ? { file } : {}) })
  const ws = new WebSocket('ws://' + location.host + '/editor?' + query, 'hinge.' + token)
  ws.binaryType = 'arraybuffer'
  let ready = false
  const resize = () => {
    if (host.clientWidth > 0 && host.clientHeight > 0) {
      fit.fit()
      if (ready) ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  term.onData((data) => {
    if (ready) ws.send(JSON.stringify({ type: 'input', data }))
  })
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') term.write(event.data)
    else {
      ready = true
      resize()
      term.focus()
    }
  }
  ws.onclose = (event) => {
    ready = false
    observer.disconnect()
    term.dispose()
    onExit(event.reason || 'Editor disconnected.')
  }
  return { focus: () => term.focus() }
}
