import { PassThrough, Writable } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'

const SESSION = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'

const calls: string[] = []
const rt = {
  live: new Map<string, any>(),
  load: async () => {},
  refresh: async () => {},
  readOnly: () => undefined,
  resolveModel: async (m: string) => m,
  defaultBotModel: () => 'magpie/nas/deepseek-v4.1-flash',
  syncModels: () => {},
  sendUser: async (args: any) => { calls.push('sendUser:' + args.sessionId) },
  createBot: async (opts: any) => { calls.push('createBot:' + JSON.stringify(opts)); return { id: 'new-bot' } },
  deleteBot: async (id: string) => { calls.push('deleteBot:' + id) },
  stopChat: async (id: string) => { calls.push('stopChat:' + id); return true },
  ensureCapabilities: async () => {},
  capabilityEndpoint: async (e: string, body: any) => { calls.push('cap:' + e + ':' + JSON.stringify(body)); return {} },
}
bindRuntime(() => rt)

async function run(label: string, cols: number, rows: number, keys: string[], before?: () => void) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable {
    constructor() { super(); this.columns = cols; this.rows = rows; this.isTTY = true }
    _write(chunk: any, _e: any, cb: any) { term.write(String(chunk), cb) }
  }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const events: string[] = []
  const channel = {
    sessionId: SESSION, provider: 'magpie', model: 'nas/deepseek-v4.1-flash',
    resumeTo: async (id: string) => { events.push(`resumeTo:${id}`); return { ok: true } },
    submit: (text: string) => { events.push(`submit:${text}`) },
    stopBackgroundAgent: async (id: string) => { events.push(`stopBg:${id}`); return true },
  }
  calls.length = 0
  before?.()
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => events.push('close') })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await new Promise(r => setTimeout(r, 350))
  for (const k of keys) { stdin.write(k); await new Promise(r => setTimeout(r, 250)) }
  await new Promise(r => setTimeout(r, 1200))
  const lines = viewportLines(term, rows)
  await app.unmount()
  console.log(`=== ${label} ===`)
  for (const line of lines) console.log('|' + line + '|')
  console.log('calls:', JSON.stringify(calls)); console.log('events:', JSON.stringify(events)); console.log('')
}

await run('send to Chief', 80, 24, ['m', 'hello', '\r'])
await run('create bot', 80, 24, ['c', 'Tester,测试', '\r'])
await run('stop Dev', 80, 24, ['j', 's'])
await run('delete Dev (x x)', 80, 24, ['j', 'x', 'x'])
await run('selection stable when Dev starts working', 80, 24, [], () => {
  observe({ id: '7c5ef88c-2ebf-4378-9ada-fa7257a5910e' }, { type: 'turn/start', time: Date.now() })
})
