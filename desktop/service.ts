// A private line protocol couples the service lifetime to its desktop parent.
// The parent installs a Windows kill-on-close job before sending "start".
import { createInterface } from 'node:readline'
import { createWorkbench } from '../server/app.ts'

const [root, portString] = process.argv.slice(2)
const input = createInterface({input:process.stdin})
let workbench:Awaited<ReturnType<typeof createWorkbench>>|undefined
let started = false, closing = false
async function shutdown() {
  if(closing) return
  closing = true
  await workbench?.close()
  process.exit(0)
}
input.on('close',()=>void shutdown())
input.on('line',async command=>{
  if(command === 'stop') { await shutdown(); return }
  if(command !== 'start' || started) return
  started = true
  try {
    workbench = await createWorkbench({root})
    workbench.server.once('error',error=>{console.error(error.message); process.exit(1)})
    workbench.server.listen(Number(portString),'127.0.0.1',()=>{
      const address=workbench!.server.address()
      if(address && typeof address !== 'string') console.log('PIVOT_READY '+address.port)
    })
  } catch(error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
})
