import { PassThrough, Writable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'

const ROOT = resetProbeHome('compact')
const LAYOUT = join(ROOT, '.dsh-tui', 'dsh-bot-tui-layout.json')

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
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

async function mount(cols: number, rows: number) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable {
    columns = cols
    rows = rows
    isTTY = true
    _write(c: any, _e: any, cb: any) { term.write(String(c), cb) }
  }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdout = new FakeStdout()
  const stdin = new FakeStdin()
  const channel = { sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout, stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(500)
  return { term, stdin, stdout, app }
}
const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')
const rowWith = (view: string, needle: string) => view.split('\n').find((line) => line.includes(needle))

// Narrow first run: the default is compact, and widening does not switch back.
{
  const { term, stdin, stdout, app } = await mount(60, 24)
  let view = await screen(term, 24)
  let row = rowWith(view, 'COS')
  expect('a narrow terminal starts compact', row !== undefined, view.slice(0, 1200))
  expect('compact drops the full role', row !== undefined && !row.includes('Chief of Staff'), row ?? '')
  expect('compact drops the status text', row !== undefined && !row.includes('空闲'), row ?? '')
  expect('compact keeps the detail usable', view.includes('最近：') && !view.includes('最近消息'), view.slice(0, 1400))
  expect('compact detail stays short', !view.includes('Enter 进入 · m 发消息 · s 停止'), view.slice(0, 1400))
  stdout.columns = 100
  stdout.emit('resize')
  await wait(600)
  view = await screen(term, 24)
  row = rowWith(view, 'COS')
  expect('widening does not auto-switch back', row !== undefined, view.slice(0, 1400))
  stdin.write('C'); await wait(500)
  view = await screen(term, 24)
  row = rowWith(view, 'Chief of Staff')
  expect('C switches to the normal layout', row !== undefined, view.slice(0, 1400))
  stdin.write('C'); await wait(500)
  view = await screen(term, 24)
  row = rowWith(view, 'COS')
  expect('C switches back to compact', row !== undefined, view.slice(0, 1400))
  await app.unmount(); await wait(150)
}

// The compact choice is stored under $DSH_TUI_HOME and survives a remount.
{
  const saved = JSON.parse(readFileSync(LAYOUT, 'utf8'))
  expect('the layout choice is persisted', saved.compact === true, JSON.stringify(saved))
  const { term, stdin, app } = await mount(100, 30)
  const view = await screen(term, 30)
  const row = rowWith(view, 'COS')
  expect('a remount keeps compact', row !== undefined, view.slice(0, 1400))
  stdin.write('C'); await wait(500)
  const normal = await screen(term, 30)
  expect('a remount can still switch to normal', rowWith(normal, 'Chief of Staff') !== undefined, normal.slice(0, 1400))
  await app.unmount(); await wait(150)
}

// A wide first run that is narrowed auto-enters compact; widening again keeps
// that layout instead of switching back.
{
  resetProbeHome('compact-resize')
  const { term, stdin, stdout, app } = await mount(100, 30)
  let view = await screen(term, 30)
  expect('a wide first run starts normal', rowWith(view, 'Chief of Staff') !== undefined, view.slice(0, 1400))
  stdout.columns = 60
  stdout.emit('resize')
  await wait(600)
  view = await screen(term, 30)
  expect('narrowing enters compact', rowWith(view, 'COS') !== undefined, view.slice(0, 1400))
  stdout.columns = 100
  stdout.emit('resize')
  await wait(600)
  view = await screen(term, 30)
  expect('widening keeps compact', rowWith(view, 'COS') !== undefined, view.slice(0, 1400))
  await app.unmount(); await wait(150)
}

// A wide first run starts normal; C turns compact on and the choice persists.
{
  resetProbeHome('compact-wide')
  const { term, stdin, app } = await mount(100, 30)
  let view = await screen(term, 30)
  let row = rowWith(view, 'Chief of Staff')
  expect('a wide terminal starts normal', row !== undefined, view.slice(0, 1400))
  expect('normal keeps the status text', row !== undefined && row.includes('空闲'), row ?? '')
  const selectedBefore = rowWith(view, '❯')
  stdin.write('C'); await wait(500)
  view = await screen(term, 30)
  row = rowWith(view, 'COS')
  expect('C turns compact on a wide terminal', row !== undefined, view.slice(0, 1400))
  const selectedAfter = rowWith(view, '❯')
  expect('the selected row is kept', selectedBefore?.includes('Chief') === true && selectedAfter?.includes('Chief') === true, `${selectedBefore ?? ''} / ${selectedAfter ?? ''}`)
  await app.unmount(); await wait(150)
  const { term: term2, app: app2 } = await mount(100, 30)
  const again = await screen(term2, 30)
  expect('the wide terminal remounts compact', rowWith(again, 'COS') !== undefined, again.slice(0, 1400))
  await app2.unmount(); await wait(150)
}

if (failures > 0) {
  console.log(`${failures} compact check(s) failed`)
  process.exit(1)
}
console.log('compact checks passed')
