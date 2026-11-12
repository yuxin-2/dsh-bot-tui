import { Writable } from 'node:stream'
import { PassThrough } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'

class FakeStdout extends Writable {
  columns = 80
  rows = 24
  isTTY = true
  output = ''
  _write(chunk: any, _enc: any, cb: any) { this.output += String(chunk); cb() }
}

const stdout = new FakeStdout()
const stdin = new PassThrough() as any
stdin.isTTY = true
stdin.setRawMode = () => {}
stdin.ref = () => {}
stdin.unref = () => {}
stdin.resume = () => {}
stdin.pause = () => {}

const events: string[] = []
const channel = {
  sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7',
  provider: 'magpie',
  model: 'nas/deepseek-v4.1-flash',
  resumeTo: async (id: string) => { events.push(`resumeTo:${id}`); return { ok: true } },
  submit: (text: string) => { events.push(`submit:${text}`) },
}

const app = await render(
  React.createElement(ThemeProvider, null,
    React.createElement(TeamScene, { React, ui, channel, close: () => { events.push('close') } })
  ),
  { stdout, stdin, exitOnCtrlC: false, patchConsole: false },
)

await new Promise(r => setTimeout(r, 250))
console.log('--- OUTPUT ---')
console.log(stdout.output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))
console.log('--- EVENTS ---', events)
app.unmount()
await new Promise(r => setTimeout(r, 50))
