import { Fault } from './workspace.ts'

const source = 'https://raw.githubusercontent.com/monkeytypegame/monkeytype/master/frontend/src/ts/constants/themes.ts'
const fields = ['bg', 'main', 'caret', 'sub', 'subAlt', 'text', 'error'] as const
type Colors = Record<typeof fields[number],string>
let cached: { until:number; data:Record<string,Colors> } | undefined
let loading: Promise<Record<string,Colors>> | undefined

export async function monkeytypeThemes() {
  if (cached && Date.now() < cached.until) return cached.data
  loading ??= (async () => {
    const response = await fetch(source, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('Upstream palette request failed.')
    const text = await response.text()
    const catalog: Record<string,Colors> = Object.create(null)
    for (const match of text.matchAll(/^  (?:"([\w-]+)"|'([\w-]+)'|([\w-]+)):\s*\{([\s\S]*?)^  \},/gm)) {
      const colors = Object.fromEntries([...match[4].matchAll(/^    (\w+):\s*["'](#[\da-f]{3,8})["'],/gim)]
        .map(([,key,color]) => [key,color]))
      if (fields.every(key => colors[key] && [4,5,7,9].includes(colors[key].length)))
        catalog[match[1] || match[2] || match[3]] = Object.fromEntries(fields.map(key => [key,colors[key]])) as Colors
    }
    if (!Object.keys(catalog).length) throw new Error('No upstream palettes found.')
    cached = { until:Date.now()+3600000, data:catalog }
    return catalog
  })().catch(() => {
    throw new Fault('Monkeytype palettes are unavailable. Try again when you are online.',503)
  }).finally(() => { loading=undefined })
  return loading
}
