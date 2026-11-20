import path from 'node:path'
import { execFile } from 'node:child_process'
import { lstat, mkdtemp, rename, rm, realpath, readFile, stat } from 'node:fs/promises'
import { base, executable } from '../scripts/runtime.mjs'
import { Fault, inside, relativePath, allowedName } from './workspace.ts'

type Result = { stdout: string; stderr: string; code: number }
async function git(
  cwd: string,
  args: string[],
  options: { input?: string; network?: boolean; accept?: number[]; literal?: boolean } = {},
): Promise<Result> {
  const bin = executable('git')
  if (!bin) throw new Fault('Install Git to use source control.', 503)
  const command = [
    '--no-optional-locks',
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'protocol.allow=never',
    '-c',
    'protocol.https.allow=always',
    '-c',
    'protocol.ssh.allow=always',
    '-c',
    'protocol.file.allow=always',
  ]
  if (options.literal !== false) command.push('--literal-pathspecs')
  command.push('-C', cwd, ...args)
  const result = await new Promise<Result>((resolve, reject) => {
    const child = execFile(
      bin,
      command,
      {
        cwd: base,
        windowsHide: true,
        timeout: options.network ? 120000 : 15000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_PAGER: 'cat' },
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        if (err && (typeof err.code !== 'number' || err.killed))
          return reject(
            new Fault('Git timed out, exceeded the output limit, or could not start.', 422),
          )
        resolve({ stdout, stderr, code: (err?.code as number) || 0 })
      },
    )
    child.stdin?.on('error', () => {})
    child.stdin?.end(options.input)
  })
  if (result.code !== 0 && !options.accept?.includes(result.code)) {
    // Credentials embedded in an existing remote must never reach a browser log.
    const message = (result.stderr || result.stdout || 'Git command failed.').replace(
      /(https?:\/\/)[^\s/@]+@/gi,
      '$1[redacted]@',
    )
    throw new Fault(message.trim().slice(0, 2000), 422)
  }
  return result
}
export async function excludedNames(cwd: string, names: string[]) {
  if (!names.length || !executable('git')) return new Set<string>()
  const result = await git(cwd, ['check-ignore', '-z', '--stdin'], {
    input: names.join('\0') + '\0',
    accept: [1, 128],
    literal: false,
  })
  return new Set(result.stdout.split('\0').map((name) => name.replace(/\/$/, '')))
}
// Automatic reads must not invoke programs configured as Git clean/process filters.
// Git may otherwise launch them while refreshing the index for status or diff.
async function passiveGit(cwd: string, args: string[]) {
  const filters = await git(
    cwd,
    ['config', '--null', '--name-only', '--get-regexp', '^filter\\..*\\.(clean|process|smudge)$'],
    { accept: [1] },
  )
  const overrides: string[] = []
  for (const name of new Set(
    filters.stdout
      .split('\0')
      .filter(Boolean)
      .map((key) => key.slice(0, key.lastIndexOf('.'))),
  )) {
    overrides.push(
      '-c',
      name + '.clean=',
      '-c',
      name + '.process=',
      '-c',
      name + '.smudge=',
      '-c',
      name + '.required=false',
    )
  }
  return git(cwd, [...overrides, ...args])
}
type Change = { path: string; index: string; worktree: string }
export async function gitState(cwd: string, detail = true) {
  const empty = {
    available: false,
    branch: '',
    changes: [] as Change[],
    branches: [] as string[],
    remote: false,
    topLevel: false,
  }
  if (!executable('git')) return empty
  const prefix = await git(cwd, ['rev-parse', '--show-prefix'], { accept: [128] })
  if (prefix.code) return empty
  const result = await passiveGit(cwd, [
    'status',
    '--porcelain=v1',
    '--branch',
    '--ignore-submodules=all',
    '--no-renames',
    '-z',
    '--untracked-files=all',
    '--',
    '.',
  ])
  const [head, ...lines] = result.stdout.split('\0')
  const branch = head.replace(/^## (?:No commits yet on |Initial commit on )?/, '').split('...')[0]
  const scope = prefix.stdout.trimEnd()
  const changes = lines
    .filter(Boolean)
    .map((s) => ({ path: s.slice(3).slice(scope.length), index: s[0], worktree: s[1] }))
  const branches = detail
    ? (await git(cwd, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'])).stdout
        .trimEnd()
        .split('\n')
        .filter(Boolean)
    : []
  const remote = detail && Boolean((await git(cwd, ['remote'])).stdout.trim())
  return { available: true, branch, changes, branches, remote, topLevel: scope === '' }
}
async function pathspec(cwd: string, p: unknown) {
  const rel = relativePath(p)
  if (rel === '.') throw new Fault('Select one changed file.')
  // Deleted paths can no longer be realpathed. Reject escape paths lexically;
  // existing parent links must also remain within the selected repository.
  let parent = path.posix.dirname(rel)
  while (parent !== '.') {
    try {
      await inside(cwd, parent, 'directory')
      break
    } catch (e) {
      if (!(e instanceof Fault && e.status === 404)) throw e
    }
    parent = path.posix.dirname(parent)
  }
  return rel
}
export async function diff(cwd: string, p: unknown, staged: boolean, full = false) {
  const rel = await pathspec(cwd, p)
  const gitArgs = [
    'diff',
    '--no-ext-diff',
    '--no-textconv',
    '--no-color',
      ...(full ? ['--unified=1000000'] : []),
    ...(staged ? ['--cached'] : []),
    '--',
    rel,
  ]
  const contextArgs=gitArgs.filter(arg=>arg!=='--unified=1000000')
  let result=await passiveGit(cwd,gitArgs).catch(error=>{
    if(full&&error instanceof Fault&&error.status===422&&error.message.includes('output limit'))
      return undefined
    throw error
  })
  if(!result||(full&&result.stdout.split('\n',5002).length>=5002))result=await passiveGit(cwd,contextArgs)
  if (result.stdout || staged) return result.stdout || 'No staged difference.'
  const info = await git(cwd, ['ls-files', '--error-unmatch', '--', rel], { accept: [1] })
  if (info.code === 0) return 'No working-tree difference.'
  const file = await inside(cwd, rel, 'file')
  if ((await stat(file)).size > 256 * 1024) return 'Untracked file is too large for a diff preview.'
  const bytes = await readFile(file)
  if (bytes.includes(0)) return 'Untracked binary file.'
  const text=bytes.toString('utf8')
  if(!text)return 'New empty file.'
  const hasFinalNewline=text.endsWith('\n')
  const lines=(hasFinalNewline?text.slice(0,-1):text).split('\n')
  return ['--- /dev/null','+++ '+rel,`@@ -0,0 +1,${lines.length} @@`,
    ...lines.map(line=>'+'+line),...(hasFinalNewline?[]:['\\ No newline at end of file']),''].join('\n')
}
export async function gitAction(cwd: string, req: Record<string, unknown>) {
  const state = await gitState(cwd)
  if (!state.available) throw new Fault('Open a Git repository.')
  if (!state.topLevel) throw new Fault('Select the repository root before changing Git state.', 409)
  let args: string[],
    network = false
  switch (req.action) {
    case 'stage':
      args = ['add', '--', await pathspec(cwd, req.path)]
      break
    case 'unstage': {
      const file = await pathspec(cwd, req.path)
      const head = await git(cwd, ['rev-parse', '--verify', 'HEAD'], { accept: [128] })
      args = head.code ? ['rm', '--cached', '--', file] : ['restore', '--staged', '--', file]
      break
    }
    case 'commit': {
      const msg = String(req.message ?? '').trim()
      if (!msg || msg.length > 4096 || msg.includes('\0'))
        throw new Fault('Enter a commit message (up to 4096 characters).')
      args = ['commit', '-m', msg]
      break
    }
    case 'checkout':
    case 'branch': {
      const branch = String(req.branch || '')
      if (
        !branch ||
        branch.startsWith('-') ||
        branch.startsWith('@') ||
        branch.length > 160 ||
        /[\s\x00-\x1f]/.test(branch)
      )
        throw new Fault('Invalid branch name.')
      await git(cwd, ['check-ref-format', '--branch', branch])
      if (req.action === 'checkout' && state.changes.length)
        throw new Fault('Commit or stash your changes before switching branches.', 409)
      args = req.action === 'checkout' ? ['switch', '--no-guess', branch] : ['switch', '-c', branch]
      break
    }
    case 'fetch':
      args = ['fetch', '--no-recurse-submodules']
      network = true
      break
    case 'pull':
      if (state.changes.length) throw new Fault('Commit or stash your changes before pulling.', 409)
      args = ['pull', '--ff-only', '--no-rebase', '--no-recurse-submodules']
      network = true
      break
    case 'push': {
      const branch = (await git(cwd, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim()
      const remote =
        (
          await git(cwd, ['config', '--get', 'branch.' + branch + '.remote'], { accept: [1] })
        ).stdout.trim() || 'origin'
      if (remote === '.' || remote.startsWith('-'))
        throw new Fault('Configure an upstream remote for this branch.')
      const merge = (
        await git(cwd, ['config', '--get', 'branch.' + branch + '.merge'], { accept: [1] })
      ).stdout.trim()
      args = [
        'push',
        '--no-force',
        '--set-upstream',
        remote,
        'HEAD:' + (merge || 'refs/heads/' + branch),
      ]
      network = true
      break
    }
    default:
      throw new Fault('Unknown Git action.')
  }
  const result = await git(cwd, args, { network })
  return {
    output:
      (result.stdout + result.stderr).replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@').trim() ||
      'Done.',
  }
}
export async function cloneRepo(root: string, folder: string, url: unknown, name: unknown) {
  if (
    typeof url !== 'string' ||
    typeof name !== 'string' ||
    !allowedName(name) ||
    !name ||
    name.length > 100
  )
    throw new Fault('Enter the repository URL and a new folder name.')
  const dir = await inside(root, folder, 'directory')
  let remote: string
  if (/^(https|ssh):\/\//.test(url)) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new Fault('Invalid repository URL.')
    }
    if (
      parsed.password ||
      (parsed.protocol === 'https:' && parsed.username) ||
      parsed.search ||
      parsed.hash
    )
      throw new Fault('Use your Git credential manager for repository credentials.')
    remote = url
  } else if (/^git@[a-zA-Z0-9.-]+:[a-zA-Z0-9._/-]+$/.test(url)) remote = url
  else remote = await inside(root, url, 'directory')
  const dest = path.join(dir, name)
  const exists = await lstat(dest)
    .then(() => true)
    .catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false
      throw e
    })
  if (exists) throw new Fault('Choose a folder name that does not already exist.', 409)
  const temp = await mkdtemp(path.join(dir, '.pivot-clone-'))
  try {
    await git(dir, ['clone', '--no-hardlinks', '--', remote, temp], { network: true })
    await rename(temp, dest)
  } finally {
    const resolved = await realpath(temp).catch(() => null)
    if (
      resolved &&
      path.dirname(resolved) === dir &&
      path.basename(resolved).startsWith('.pivot-clone-')
    )
      await rm(resolved, { force: true, recursive: true })
  }
  return { folder: folder === '.' ? name : folder + '/' + name }
}
