import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync, accessSync, constants } from 'node:fs'

export const base = fileURLToPath(new URL('../', import.meta.url))
export const editorHome = path.join(base, '.hinge', 'editor')
export const profile = path.join(base, 'editor', 'init.lua')
export function executable(name, override) {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  const paths = override
    ? [override]
    : (process.env.PATH || '')
        .split(path.delimiter)
        .filter(path.isAbsolute)
        .map((dir) => path.join(dir, name + suffix))
  for (const item of paths.filter(path.isAbsolute)) {
    try {
      accessSync(item, constants.X_OK)
      return item
    } catch {}
  }
}
export function nvimPath() {
  const portable = path.join(base, '.hinge/bin/nvim-win64/bin/nvim.exe')
  return executable('nvim', process.env.HINGE_NVIM || (existsSync(portable) ? portable : undefined))
}
export function pythonPath() {
  const venv = path.join(
    base,
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  )
  return executable('python', process.env.HINGE_PYTHON || venv)
}
export function editorEnv() {
  const index = Number(process.env.GIT_CONFIG_COUNT || 0)
  const localGit = path.join(base, '.hinge/bin/lazygit')
  return {
    ...process.env,
    HINGE_EDITOR: editorHome,
    NVIM_APPNAME: 'hinge',
    PATH: existsSync(path.join(localGit, 'lazygit.exe'))
      ? localGit + path.delimiter + process.env.PATH
      : process.env.PATH,
    GIT_CONFIG_COUNT: String(index + 1),
    ['GIT_CONFIG_KEY_' + index]: 'core.longpaths',
    ['GIT_CONFIG_VALUE_' + index]: 'true',
    XDG_CONFIG_HOME: path.join(editorHome, 'config'),
    XDG_DATA_HOME: path.join(editorHome, 'data'),
    XDG_STATE_HOME: path.join(editorHome, 'state'),
    XDG_CACHE_HOME: path.join(editorHome, 'cache'),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
}
