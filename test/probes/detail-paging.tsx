import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  observe, resetProbeHome,
} from './harness.mjs'

resetProbeHome('detail-paging')

const SESSION_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const SESSION_B = 'sess-b'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

type Event = { seq: number; type: string; time: number; data: any }
let events: Event[] = []
let pageCalls: any[] = []

const controller = {
  page: async (request: any) => {
    pageCalls.push(request)
    const max = Number(request.maxMessages ?? 50)
    const end = request.beforeSeq === undefined
      ? events.length
      : events.findIndex((event) => event.seq >= request.beforeSeq)
    const stop = end < 0 ? events.length : end
    const start = Math.max(0, stop - max)
    const slice = events.slice(start, stop)
    // The real page() returns chronological records with the events that made
    // up the message; this log is messages only, so one record per event.
    return { records: slice.map((event) => ({ type: 'event', event })), hasMore: start > 0 }
  },
}

const baseRuntime = () => ({
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }),
  deleteBot: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
})
let rt: any = { ...baseRuntime(), ctx: { get: (name: string) => (name === 'sessionController' ? controller : undefined) } }
bindRuntime(() => rt)

function buildEvents(count: number) {
  const base = Date.now() - count * 60000
  const list: Event[] = []
  for (let at = 1; at <= count; at += 1) {
    const user = at % 2 === 1
    list.push({
      seq: at,
      type: user ? 'user/message' : 'assistant/message',
      time: base + at * 60000,
      data: user
        ? { content: [{ type: 'text', text: `消息 ${String(at).padStart(2, '0')}` }] }
        : { message: { content: [{ type: 'text', text: `消息 ${String(at).padStart(2, '0')}` }] } },
    })
  }
  return list
}

function seedLive() {
  const texts = ['实时一', '实时二', '实时三', '实时四', '实时五']
  const base = Date.now() - 300000
  texts.forEach((text, at) => {
    const user = at % 2 === 0
    observe({ id: SESSION_A }, {
      type: user ? 'user/message' : 'assistant/message',
      time: base + at * 1000,
      data: user
        ? { content: [{ type: 'text', text }] }
        : { message: { content: [{ type: 'text', text }] } },
    })
  })
}

async function mount(cols = 120, rows = 50) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: SESSION_A, provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}

const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')
const PG_UP = '\u001b[5~'
const PG_DN = '\u001b[6~'

// First screen is live; PgUp reads the newest stored page, then walks back.
{
  events = buildEvents(45)
  pageCalls = []
  seedLive()
  const { term, stdin, app } = await mount()
  const live = await screen(term, 50)
  expect('the first screen shows the live five', live.includes('最近消息') && live.includes('实时五'), live.slice(0, 400))
  expect('the first screen is not history', !live.includes('历史 · 第'), live.slice(0, 200))

  stdin.write(PG_UP); await wait(600)
  const first = await screen(term, 50)
  expect('PgUp reads the newest history page', pageCalls.length === 1 && pageCalls[0].maxMessages === 20, JSON.stringify(pageCalls))
  expect('the page targets the selected Bot session', pageCalls[0]?.address?.sessionId === SESSION_A, JSON.stringify(pageCalls[0]?.address))
  expect('the header names the page and more', first.includes('历史 · 第 1 页 · 还有更早'), first.slice(0, 600))
  expect('the newest page shows its newest message', first.includes('消息 45'), first.slice(0, 600))
  expect('the newest page shows its oldest message', first.includes('消息 26'), first.slice(0, 900))
  expect('the newest page does not show older rows', !first.includes('消息 25'), first.slice(0, 900))

  stdin.write(PG_UP); await wait(600)
  const second = await screen(term, 50)
  expect('PgUp asks for the page below the first', pageCalls.length === 2 && pageCalls[1].beforeSeq === 26, JSON.stringify(pageCalls))
  expect('the header advances to page two', second.includes('历史 · 第 2 页 · 还有更早'), second.slice(0, 600))
  expect('page two shows its newest message', second.includes('消息 25'), second.slice(0, 900))
  expect('page two shows its oldest message', second.includes('消息 06'), second.slice(0, 900))

  stdin.write(PG_UP); await wait(600)
  const third = await screen(term, 50)
  expect('the last page is shorter and marked', pageCalls.length === 3 && pageCalls[2].beforeSeq === 6 && third.includes('历史 · 第 3 页 · 已到最早'), JSON.stringify(pageCalls))
  expect('the last page shows its rows', third.includes('消息 05') && third.includes('消息 01'), third.slice(0, 900))

  stdin.write(PG_UP); await wait(500)
  const bottom = await screen(term, 50)
  expect('PgUp at the bottom asks for nothing', pageCalls.length === 3, JSON.stringify(pageCalls))
  expect('the bottom is stated, not blank', bottom.includes('已到最早'), bottom.slice(0, 600))

  stdin.write(PG_DN); await wait(400)
  const back = await screen(term, 50)
  expect('PgDn walks toward the newer page', back.includes('第 2 页'), back.slice(0, 500))
  stdin.write(PG_DN); await wait(400)
  expect('PgDn reaches the newest page', (await screen(term, 50)).includes('第 1 页'), '')
  stdin.write(PG_DN); await wait(500)
  const liveAgain = await screen(term, 50)
  expect('PgDn past the newest returns to live', liveAgain.includes('最近消息') && !liveAgain.includes('历史 · 第'), liveAgain.slice(0, 500))
  expect('returning to live does not re-read', pageCalls.length === 3, JSON.stringify(pageCalls))
  await app.unmount(); await wait(120)
}

// A session with no stored log says so instead of showing an empty panel.
{
  events = []
  pageCalls = []
  const { term, stdin, app } = await mount()
  stdin.write(PG_UP); await wait(600)
  const empty = await screen(term, 50)
  expect('an empty log is stated', empty.includes('第 1 页 · 没有更早的记录'), empty.slice(0, 700))
  expect('an empty log is not a silent blank', pageCalls.length === 1 && empty.includes('最近消息'), JSON.stringify(pageCalls))
  await app.unmount(); await wait(120)
}

// A runtime without the page service degrades with a clear message.
{
  events = buildEvents(45)
  pageCalls = []
  rt = baseRuntime()
  const { term, stdin, app } = await mount()
  stdin.write(PG_UP); await wait(600)
  const unsupported = await screen(term, 50)
  expect('no page capability is stated', unsupported.includes('历史不可用：当前运行时没有 page 能力'), unsupported.slice(0, 700))
  expect('no page capability calls nothing', pageCalls.length === 0, JSON.stringify(pageCalls))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} detail-paging check(s) failed`)
  process.exit(1)
}
console.log('detail-paging checks passed')