import { PassThrough, Writable } from 'node:stream'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, activityOf, resetProbeHome } from './harness.mjs'

resetProbeHome('detail')

const BOT_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const BOT_B = 'sess-b'
const RING = 'ring-session'
const now = Date.now()

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
  stopChat: async () => true, ensureCapabilities: async () => {},
  capabilityEndpoint: async () => ({}),
}
bindRuntime(() => rt)

// Five messages plus one more: the ring keeps the newest five, and the long
// assistant line checks the 160-character cut.
observe({ id: BOT_A }, { type: 'turn/start', time: now - 5 * 60000 })
observe({ id: BOT_A }, { type: 'user/message', time: now - 4 * 60000, data: { content: [{ type: 'text', text: '帮我看看构建' }] } })
for (let at = 0; at < 3; at += 1) {
  observe({ id: BOT_A }, { type: 'assistant/message', time: now - (3 - at) * 30000, data: { message: { content: [{ type: 'text', text: `回复 ${at + 1}` }] } } })
}
const longText = '很长的回复'.repeat(40)
observe({ id: BOT_A }, { type: 'assistant/message', time: now - 1000, data: { message: { content: [{ type: 'text', text: longText }] } } })

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

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
  await wait(400)
  return { term, stdin, app }
}

async function screen(term: any, rows: number) {
  return viewportLines(term, rows).join('\n')
}

// Wide, with a live record.
{
  const { term, stdin, app } = await mount(120, 34)
  const text = await screen(term, 34)
  expect('wide shows the message panel', text.includes('最近消息'), text.slice(0, 200))
  expect('wide shows both roles', text.includes('你') && text.includes('Bot'))
  expect('wide shows relative times', /(?:\d+[smh] 前|—)/.test(text))
  expect('wide shows the actions', text.includes('Enter 进入 · m 发消息 · s 停止'))
  expect('wide shows status and elapsed', text.includes('已运行 5m'))
  console.log('--- wide live ---')
  for (const line of (await screen(term, 34)).split('\n').slice(0, 30)) console.log('|' + line + '|')

  stdin.write('j'); await wait(350)
  const empty = await screen(term, 34)
  expect('wide follows the cursor', empty.includes('Dev') && empty.includes('暂无消息'), empty.slice(0, 200))
  expect('wide shows zero unread', empty.includes('未读 0'))

  stdin.write(' '); await wait(350)
  const collapsed = await screen(term, 34)
  expect('space collapses the panel', !collapsed.includes('最近消息') && !collapsed.includes('暂无消息'))
  stdin.write(' '); await wait(350)
  const expanded = await screen(term, 34)
  expect('space expands the panel again', expanded.includes('最近消息') || expanded.includes('暂无消息'))
  await app.unmount(); await wait(100)
}

// Narrow: the detail is two lines under the roster.
{
  const { term, stdin, app } = await mount(80, 24)
  const live = await screen(term, 24)
  expect('narrow shows a two-line summary', live.includes('最近：'), live.slice(0, 200))
  expect('narrow shows status and elapsed', live.includes('已运行 5m'))
  console.log('--- narrow live ---')
  for (const line of live.split('\n').slice(0, 20)) console.log('|' + line + '|')

  stdin.write('j'); await wait(350)
  const empty = await screen(term, 24)
  expect('narrow shows no messages for a fresh Bot', empty.includes('最近：') && empty.includes('暂无消息'), empty.slice(0, 200))
  await app.unmount(); await wait(100)
}

// Overflow and truncation on a separate session, so the rendered Bot keeps
// both a user and an assistant row.
for (let at = 0; at < 7; at += 1) {
  observe({ id: RING }, { type: 'assistant/message', time: now - at * 1000, data: { message: { content: [{ type: 'text', text: at === 6 ? longText : `ring ${at}` }] } } })
}
const record = activityOf(BOT_A)
const messages = record?.messages ?? []
const ring = activityOf(RING)?.messages ?? []
expect('ring keeps at most five messages', ring.length === 5, String(ring.length))
expect('ring keeps the newest messages', ring[4]?.text.length === 161, String(ring[4]?.text.length))
expect('ring keeps roles', messages.some((m: any) => m.role === 'user') && messages.some((m: any) => m.role === 'assistant'))
expect('each message is cut to 160 chars', [...messages, ...ring].every((m: any) => m.text.length <= 161), String(Math.max(...[...messages, ...ring].map((m: any) => m.text.length))))

if (failures > 0) {
  console.log(`${failures} detail check(s) failed`)
  process.exit(1)
}
console.log('detail checks passed')