import { PassThrough, Writable } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'
const calls: string[] = []
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'x', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {}, stopChat: async () => true,
  ensureCapabilities: async (id: string) => { calls.push('ensure:' + id) },
  capabilityEndpoint: async (e: string, body: any) => { calls.push('cap:' + e + ':' + body.name); return {} },
}
bindRuntime(() => rt)
const term = new XTerm({ cols: 80, rows: 24, scrollback: 0, allowProposedApi: true })
class FakeStdout extends Writable { columns = 80; rows = 24; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
const stdin = new FakeStdin()
const channel = { sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', provider: 'magpie', model: 'nas/deepseek-v4.1-flash', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
const app = await render(React.createElement(ThemeProvider, { theme: 'dark' }, React.createElement(TeamScene, { React, ui, channel, close: () => {} })), { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
await wait(350)
for (const k of ['p', '\r']) { stdin.write(k); await wait(300) }
await wait(500)
for (const l of viewportLines(term, 24).slice(0, 16)) console.log('|' + l + '|')
console.log('calls:', JSON.stringify(calls))
await app.unmount()
