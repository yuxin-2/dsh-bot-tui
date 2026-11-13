import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'

const ROOT = resetProbeHome('usage-trend')
const STATE = join(ROOT, '.dsh', 'bot', 'state.json')
const LONG_NAME = '这是一个非常非常长的 Bot 名称用来验证用量行截断后详情仍然完整'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const dayKey = (offset = 0) => {
  const at = new Date()
  at.setHours(0, 0, 0, 0)
  at.setDate(at.getDate() + offset)
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`
}
const row = (day: string, owner: number, input: number, output: number, calls: number) =>
  [`${day} 10`, owner, 0, 0, input, 0, 0, output, calls]

writeFileSync(STATE, JSON.stringify({
  mainBotIds: ['bot-a'],
  revision: 1,
  bots: {
    'bot-a': { id: 'bot-a', name: LONG_NAME, role: 'Chief', model: 'p/a', sessionId: 'sess-a', segments: [], capabilities: [], instructions: '', main: true },
    'bot-b': { id: 'bot-b', name: 'Dev', role: '编码', model: 'p/b', sessionId: 'sess-b', segments: [], capabilities: [], instructions: '' },
  },
  sections: [],
  capabilities: { items: {} },
}))

const owners = [
  { key: 'bot-a', kind: 'bot', id: 'bot-a', name: LONG_NAME },
  { key: 'bot-b', kind: 'bot', id: 'bot-b', name: 'Dev' },
]
let rows: any[] = []
let available = true
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  catalog: async () => [], cachedCatalog: () => [], reasoningOf: async () => ({ efforts: [] }),
  capabilityLibraryView: () => [], capabilityStatusesView: () => ({}),
  approvalsView: () => [], permissionCatalog: () => ({ options: [], defaultPreset: undefined }),
  computerEnabled: () => false, computerView: () => ({}),
  usageView: async () => available ? { owners, rows } : { owners: [], rows: [] },
}
bindRuntime(() => rt)

async function mount(cols = 100, rows = 30) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: 'sess-a', provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}

const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')

// Single day: only today is in the trend, and the average equals the total.
{
  rows = [row(dayKey(0), 0, 1000, 200, 3)]
  available = true
  const { term, stdin, app } = await mount()
  stdin.write('Y'); await wait(500)
  stdin.write('d'); await wait(500)
  const view = await screen(term, 30)
  expect('single day shows a one-day trend', view.includes('近 1 天'), view.slice(0, 1200))
  expect('single day shows the day row', view.includes(dayKey(0).slice(5)), view.slice(0, 1200))
  expect('the top shows the total', view.includes('合计：3 次调用 · 1.2k tokens · 日均 1.2k tokens'), view.slice(0, 1200))
  await app.unmount(); await wait(120)
}

// Seven days: missing days stay in the chart at zero; long names truncate in the
// row but the detail line keeps the full name.
{
  rows = [row(dayKey(0), 0, 1000, 200, 3), row(dayKey(-2), 1, 500, 100, 2)]
  const { term, stdin, app } = await mount()
  stdin.write('Y'); await wait(500)
  const view = await screen(term, 30)
  expect('week trend covers seven days', view.includes('近 7 天'), view.slice(0, 1400))
  expect('a missing day keeps its zero row', view.includes(`${dayKey(-1).slice(5)}`) && /(^|\n).*?\b0\b/.test(view), view.slice(0, 1600))
  const rowLine = view.split('\n').find((line) => line.includes('❯') && line.includes('…'))
  expect('a long Bot name is truncated in the row', rowLine !== undefined, rowLine ?? 'no truncated row')
  expect('the detail keeps the full name', view.includes(LONG_NAME), view.slice(0, 1600))
  await app.unmount(); await wait(120)
}

// Empty ledger: an explicit empty state, not a chart of zeros.
{
  rows = []
  available = true
  const { term, stdin, app } = await mount()
  stdin.write('Y'); await wait(500)
  const view = await screen(term, 30)
  expect('an empty ledger is explicit', view.includes('还没有记录'), view.slice(0, 800))
  expect('an empty ledger has no trend chart', !view.includes('按天趋势'), view.slice(0, 800))
  await app.unmount(); await wait(120)
}

// Narrow terminal: the bar width shrinks and the date/value still fit.
{
  rows = [row(dayKey(0), 0, 1000, 200, 3), row(dayKey(-2), 1, 500, 100, 2)]
  available = true
  const { term, stdin, app } = await mount(30, 30)
  stdin.write('Y'); await wait(500)
  const view = await screen(term, 30)
  const runs = view.match(/[▁▂▃▄▅▆▇█]+/g) ?? []
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0)
  expect('narrow terminal keeps the trend', view.includes('近 7 天'), view.slice(0, 1200))
  expect('narrow terminal shrinks the bar', longest > 0 && longest <= 3, `longest=${longest}`)
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} usage trend check(s) failed`)
  process.exit(1)
}
console.log('usage trend checks passed')
