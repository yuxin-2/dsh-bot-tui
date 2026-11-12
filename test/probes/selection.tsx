import { PassThrough, Writable } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'
const SESSION = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
bindRuntime(() => ({ live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined }))

const term = new XTerm({ cols: 70, rows: 24, scrollback: 0, allowProposedApi: true })
class FakeStdout extends Writable { columns = 70; rows = 24; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
const stdin = new FakeStdin()
const channel = { sessionId: SESSION, provider: 'magpie', model: 'nas/deepseek-v4.1-flash', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
const app = await render(React.createElement(ThemeProvider, { theme: 'dark' }, React.createElement(TeamScene, { React, ui, channel, close: () => {} })), { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
await wait(350)
stdin.write('j'); await wait(250)   // select Dev
console.log('--- after j (expect ❯ Dev) ---')
for (const l of viewportLines(term, 24).slice(0, 8)) console.log('|' + l + '|')
observe({ id: '7c5ef88c-2ebf-4378-9ada-fa7257a5910e' }, { type: 'turn/start', time: Date.now() }) // bot id, not session
observe({ id: '3003c62c-abe4-4e7f-a89a-fa8ebcf1704a' }, { type: 'assistant/message', time: Date.now(), data: { message: { content: [{ type: 'text', text: 'tui 回复了' }] } } })
await wait(1300)
console.log('--- after tui gets a reply (expect ❯ Dev still) ---')
for (const l of viewportLines(term, 24).slice(0, 8)) console.log('|' + l + '|')
await app.unmount()
