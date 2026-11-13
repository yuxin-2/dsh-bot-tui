import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome, DEFAULT_STATE,
} from './harness.mjs'

const ROOT = resetProbeHome('caps-batch')
const STATE = join(ROOT, '.dsh', 'bot', 'state.json')
const LIBRARY = [
  { name: 'alpha', kind: 'mcp', description: 'Alpha MCP', approved: true },
  { name: 'beta', kind: 'skill', description: 'Beta skill' },
  { name: 'gamma', kind: 'pack', description: 'Gamma pack' },
]

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

let attached: string[] = []
let failName: string | undefined
let calls: any[] = []

const writeState = () => {
  const state = JSON.parse(JSON.stringify(DEFAULT_STATE))
  state.bots['bot-a'].capabilities = [...attached]
  writeFileSync(STATE, JSON.stringify(state))
}

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  catalog: async () => [], cachedCatalog: () => [], reasoningOf: async () => ({ efforts: [] }),
  capabilityLibraryView: () => LIBRARY,
  capabilityStatusesView: () => ({}),
  approvalsView: () => [], permissionCatalog: () => ({ options: [], defaultPreset: undefined }),
  computerEnabled: () => false, computerView: () => ({}),
  usageView: async () => ({ owners: [], rows: [] }),
  capabilityEndpoint: async (action: string, payload: any) => {
    calls.push({ action, ...payload })
    if (payload.name === failName) throw new Error('boom')
    attached = payload.attached
      ? [...new Set([...attached, payload.name])]
      : attached.filter((name) => name !== payload.name)
    writeState()
  },
}
bindRuntime(() => rt)

async function mount(cols = 110, rows = 40) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: DEFAULT_STATE.bots['bot-a'].sessionId, provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}
const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')

const openCaps = async (stdin: any) => {
  stdin.write('v')
  await wait(450)
}

// Batch mount: two selected items are mounted one by one and the summary counts them.
{
  attached = []
  failName = undefined
  calls = []
  writeState()
  const { term, stdin, app } = await mount()
  await openCaps(stdin)
  let view = await screen(term, 40)
  expect('the panel starts with no selection', view.includes('已选 0 个 · 未选'), view.slice(0, 900))
  stdin.write(' '); await wait(120)
  stdin.write('j'); await wait(120)
  stdin.write(' '); await wait(150)
  view = await screen(term, 40)
  expect('space selects multiple items', view.includes('已选 2 个 · 全部未挂载'), view.slice(0, 1200))
  expect('selected rows are marked', view.includes('[x] alpha') && view.includes('[x] beta'), view.slice(0, 1200))
  stdin.write('\r'); await wait(900)
  view = await screen(term, 40)
  expect('batch mount calls each selected item', calls.length === 2 && calls.every((c) => c.attached === true), JSON.stringify(calls))
  expect('batch mount reports success', view.includes('批量挂载完成：成功 2'), view.slice(-1200))
  expect('selection clears after a batch', view.includes('已选 0 个'), view.slice(-800))
  await app.unmount(); await wait(120)
}

// Batch unmount.
{
  attached = ['alpha', 'beta']
  failName = undefined
  calls = []
  writeState()
  const { term, stdin, app } = await mount()
  await openCaps(stdin)
  stdin.write(' '); await wait(120)
  stdin.write('j'); await wait(120)
  stdin.write(' '); await wait(150)
  const view = await screen(term, 40)
  expect('the panel shows the mounted state', view.includes('已选 2 个 · 全部已挂载'), view.slice(0, 1200))
  stdin.write('\r'); await wait(900)
  const after = await screen(term, 40)
  expect('batch unmount calls each selected item', calls.length === 2 && calls.every((c) => c.attached === false), JSON.stringify(calls))
  expect('batch unmount reports success', after.includes('批量卸载完成：成功 2'), after.slice(-1200))
  await app.unmount(); await wait(120)
}

// A failure in the middle does not stop the rest; the summary names it.
{
  attached = ['alpha', 'beta']
  failName = 'beta'
  calls = []
  writeState()
  const { term, stdin, app } = await mount()
  await openCaps(stdin)
  stdin.write(' '); await wait(120)
  stdin.write('j'); await wait(120)
  stdin.write(' '); await wait(150)
  stdin.write('\r'); await wait(900)
  const view = await screen(term, 40)
  expect('a partial failure still calls every selected item', calls.length === 2, JSON.stringify(calls))
  expect('the summary counts one success and one failure', view.includes('成功 1') && view.includes('失败 1'), view.slice(-1400))
  expect('the failure reason is named', view.includes('beta：boom'), view.slice(-1400))
  await app.unmount(); await wait(120)
}

// No selection: Enter is only a notice and never calls the endpoint.
{
  attached = []
  failName = undefined
  calls = []
  writeState()
  const { term, stdin, app } = await mount()
  await openCaps(stdin)
  stdin.write('\r'); await wait(500)
  const view = await screen(term, 40)
  expect('empty selection is explained', view.includes('没有选中能力'), view.slice(-900))
  expect('empty selection sends no calls', calls.length === 0, JSON.stringify(calls))
  await app.unmount(); await wait(120)
}

// Mixed state: the cursor decides the batch direction; already-correct items are
// skipped and counted, not called.
{
  attached = ['alpha', 'gamma']
  failName = undefined
  calls = []
  writeState()
  const { term, stdin, app } = await mount()
  await openCaps(stdin)
  stdin.write(' '); await wait(100)   // alpha
  stdin.write('j'); await wait(100)   // beta
  stdin.write(' '); await wait(100)   // beta
  stdin.write('j'); await wait(100)   // gamma
  stdin.write(' '); await wait(100)   // gamma
  stdin.write('k'); await wait(100)   // back to beta
  stdin.write('k'); await wait(100)   // back to alpha? no: cursor should end on beta
  stdin.write('j'); await wait(150)   // cursor on beta
  let view = await screen(term, 40)
  expect('a mixed selection says which way it will go', view.includes('已选 3 个 · 混合（按光标项：批量挂载）'), view.slice(0, 1400))
  stdin.write('\r'); await wait(900)
  view = await screen(term, 40)
  expect('mixed batch only calls items needing a change', calls.length === 1 && calls[0].name === 'beta' && calls[0].attached === true, JSON.stringify(calls))
  expect('mixed batch notes skipped items', view.includes('跳过 2'), view.slice(-1400))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} capability batch check(s) failed`)
  process.exit(1)
}
console.log('capability batch checks passed')
