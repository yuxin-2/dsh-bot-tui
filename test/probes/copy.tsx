import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, resetProbeHome,
} from './harness.mjs'
import { copyText, plainText } from '../../src/clipboard.js'

const ROOT = resetProbeHome('copy')
const BOT_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const BOT_B = 'sess-b'
const now = Date.now()

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

// Plain text: markdown outside a fence goes, code inside stays.
{
  const clean = plainText('# **Hi**\n```js\nconst x = 1\n```\n[link](https://example.com)')
  expect('markdown outside a fence is stripped', clean === 'Hi\nconst x = 1\nlink', JSON.stringify(clean))
  expect('code inside a fence survives', clean.includes('const x = 1'), clean)
  expect('fences and emphasis are gone', !clean.includes('```') && !clean.includes('**') && !clean.includes('#'), clean)
}

// OSC 52 is the first path and is reported as such.
{
  const writes: string[] = []
  const result = await copyText('你好 **world**', {
    write: (chunk: any) => { writes.push(String(chunk)); return true },
    spawn: () => { throw new Error('pbcopy should not run') },
  })
  const payload = writes[0]?.match(/^\x1b\]52;c;([\s\S]*)\x07$/)?.[1]
  const decoded = payload === undefined ? '' : Buffer.from(payload, 'base64').toString('utf8')
  expect('OSC 52 path succeeds', result.ok === true && result.path === 'osc52', JSON.stringify(result))
  expect('OSC 52 carries the text', decoded === '你好 **world**', JSON.stringify(decoded))
}

class FakeChild extends EventEmitter {
  data = ''
  stdin: Writable
  constructor() {
    super()
    this.stdin = new Writable({
      write: (chunk: any, _enc: any, cb: any) => { this.data += String(chunk); cb() },
    })
  }
  kill() { return this }
}

// pbcopy is the fallback when the escape cannot be written.
{
  const child = new FakeChild()
  const result = await copyText('pbcopy text', {
    write: () => { throw new Error('no osc') },
    spawn: () => { setImmediate(() => child.emit('close', 0)); return child },
  })
  expect('pbcopy fallback succeeds', result.ok === true && result.path === 'pbcopy', JSON.stringify(result))
  expect('pbcopy receives the text', child.data === 'pbcopy text', JSON.stringify(child.data))
}

// Both paths failing is reported as failure, never as success.
{
  const child = new FakeChild()
  const result = await copyText('cannot copy', {
    write: () => { throw new Error('no osc') },
    spawn: () => { setImmediate(() => child.emit('close', 1)); return child },
  })
  expect('both paths failing is not success', result.ok === false && result.path === 'pbcopy', JSON.stringify(result))
}

// Empty input never reaches a clipboard.
{
  const result = await copyText('')
  expect('empty input has no clipboard path', result.ok === false && result.path === 'empty', JSON.stringify(result))
}

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  catalog: async () => [], cachedCatalog: () => [], reasoningOf: async () => ({ efforts: [] }),
  capabilityLibraryView: () => [], capabilityStatusesView: () => ({}),
  approvalsView: () => [], permissionCatalog: () => ({ options: [], defaultPreset: undefined }),
  computerEnabled: () => false, computerView: () => ({}),
  usageView: async () => ({ owners: [], rows: [] }),
}
bindRuntime(() => rt)

const reply = '# 标题\n\n**加粗** 和 `代码`\n```js\nconst x = 1\n```\n[链接](https://example.com)'
observe({ id: BOT_A }, { type: 'assistant/message', time: now, data: { message: { content: [{ type: 'text', text: reply }] } } })

async function mount(cols: number, rows: number) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: BOT_A, provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}
const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')

// The scene path: y writes OSC 52 and reports the count.
{
  const { term, stdin, app } = await mount(100, 30)
  const original = process.stdout.write
  let escape = ''
  process.stdout.write = ((chunk: any) => { escape += String(chunk); return true }) as any
  stdin.write('y'); await wait(700)
  process.stdout.write = original
  const view = await screen(term, 30)
  const payload = escape.match(/\x1b\]52;c;([\s\S]*?)\x07/)?.[1]
  const copied = payload === undefined ? '' : Buffer.from(payload, 'base64').toString('utf8')
  expect('y copies via OSC 52', payload !== undefined, JSON.stringify(escape.slice(0, 80)))
  expect('copied text is plain', copied.includes('标题') && copied.includes('加粗 和 代码') && copied.includes('const x = 1') && copied.includes('链接'), JSON.stringify(copied))
  expect('copied text drops markdown', !copied.includes('**') && !copied.includes('```') && !copied.includes('#'), JSON.stringify(copied))
  expect('success notice has the count', view.includes(`已复制最近回复（${Array.from(copied).length} 字）`), view.slice(-900))
  await app.unmount(); await wait(150)
}

// A Bot with no assistant reply gets an explicit empty notice and no clipboard write.
{
  const { term, stdin, app } = await mount(100, 30)
  const original = process.stdout.write
  let escape = ''
  process.stdout.write = ((chunk: any) => { escape += String(chunk); return true }) as any
  stdin.write('j'); await wait(250)
  stdin.write('y'); await wait(600)
  process.stdout.write = original
  const view = await screen(term, 30)
  expect('no reply is explicit', view.includes('没有可复制的 assistant 回复'), view.slice(-900))
  expect('no reply writes no clipboard escape', !escape.includes('\x1b]52;c;'), JSON.stringify(escape.slice(0, 80)))
  await app.unmount(); await wait(150)
}

if (failures > 0) {
  console.log(`${failures} copy check(s) failed`)
  process.exit(1)
}
console.log('copy checks passed')
