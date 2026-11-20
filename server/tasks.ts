import path from 'node:path'
import { readFile, lstat } from 'node:fs/promises'
import { base, executable } from '../scripts/runtime.mjs'
import { Fault, inside } from './workspace.ts'

export function ghPath() {
  return executable('gh') || executable('gh', path.join(base, '.pivot', 'bin', 'gh', 'bin', 'gh.exe'))
}
async function readJson(dir: string, name: string) {
  const file = await inside(dir, name, 'file').catch(() => null)
  if (!file || (await lstat(file)).size > 256 * 1024) return {}
  try {
    const data = JSON.parse(await readFile(file, 'utf8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}
export async function tasks(dir: string) {
  const output: { id: string; label: string; command: string }[] = []
  const pkg = await readJson(dir, 'package.json')
  for (const name of Object.keys(pkg.scripts || {}).sort()) {
    if (output.length >= 100) break
    if (/^[A-Za-z0-9_][A-Za-z0-9_:.-]{0,63}$/.test(name))
      output.push({ id: 'npm:' + name, label: 'npm · ' + name, command: 'npm run ' + name })
  }
  const config = await readJson(dir, '.pivot-tasks.json')
  for (const [name, cmd] of Object.entries(config.tasks || {})) {
    if (output.length >= 160) break
    if (
      typeof cmd === 'string' &&
      typeof name === 'string' &&
      name.length <= 80 &&
      cmd.length <= 2048 &&
      !/[\x00-\x1f]/.test(cmd)
    )
      output.push({ id: 'project:' + name, label: name, command: cmd })
  }
  if (executable('docker')) {
    const dockerfile = await inside(dir, 'Dockerfile', 'file').catch(() => null)
    if (dockerfile)
      output.push({ id: 'docker:build', label: 'Docker · build image', command: 'docker build .' })
    for (const name of ['compose.yaml', 'compose.yml', 'docker-compose.yml', 'docker-compose.yaml']) {
      if (await inside(dir, name, 'file').catch(() => null)) {
        output.push({
          id: 'docker:compose',
          label: 'Docker · compose up',
          command: 'docker compose -f ' + name + ' up',
        })
        break
      }
    }
  }
  const github = Boolean(ghPath())
  if (github) {
    output.push({
      id: 'github:login',
      label: 'GitHub · sign in',
      command: 'gh auth login --hostname github.com --web --git-protocol https',
    })
    output.push({
      id: 'github:status',
      label: 'GitHub · account status',
      command: 'gh auth status --hostname github.com',
    })
  }
  return { tasks: output, github, wsl: process.platform === 'win32' && Boolean(executable('wsl')) }
}
export async function taskCommand(cwd: string, id: unknown) {
  const task = (await tasks(cwd)).tasks.find((t) => t.id === id)
  if (!task) throw new Fault('This task is no longer available.')
  return task.command
}
