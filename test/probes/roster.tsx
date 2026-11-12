import { PassThrough, Writable } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'


const SESSION = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'

async function run(label: string, cols: number, rows: number, keys: string[] = [], setup?: () => void) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable {
    constructor() { super(); this.columns = cols; this.rows = rows; this.isTTY = true }
    _write(chunk: any, _e: any, cb: any) { term.write(String(chunk), cb) }
  }
  class FakeStdin extends PassThrough {
    isTTY = true
    setRawMode() { return this }
    ref() { return this }
    unref() { return this }
  }
  const stdin = new FakeStdin()
  const events: string[] = []
  const channel = {
    sessionId: SESSION,
    provider: 'magpie',
    model: 'nas/deepseek-v4.1-flash',
    resumeTo: async (id: string) => { events.push(`resumeTo:${id}`); return { ok: true } },
    submit: (text: string) => { events.push(`submit:${text}`) },
    stopBackgroundAgent: async (id: string) => { events.push(`stop:${id}`); return true },
  }
  setup?.()
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => events.push('close') })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false },
  )
  await new Promise(r => setTimeout(r, 350))
  for (const k of keys) {
    stdin.write(k)
    await new Promise(r => setTimeout(r, 220))
  }
  const lines = viewportLines(term, rows)
  await app.unmount()
  console.log(`=== ${label} ===`)
  for (const line of lines) console.log('|' + line + '|')
  if (events.length) console.log('events:', JSON.stringify(events))
  console.log('')
}

await run('80x24 default', 80, 24)
await run('60x20 narrow', 60, 20)
await run('44x18 narrow', 44, 18)
await run('36x16 very narrow', 36, 16)
await run('message mode -> send', 80, 24, ['m', 'hello', '\r'])
await run('create mode', 80, 24, ['c'])
await run('approve mode', 80, 24, ['p'])
