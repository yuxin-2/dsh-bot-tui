import { PassThrough, Writable } from 'node:stream'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  resetProbeHome,
} from './harness.mjs'

const ROOT = resetProbeHome('collapse')
const STATE = join(ROOT, '.dsh', 'bot', 'state.json')
const COLLAPSED = join(ROOT, '.dsh-tui', 'dsh-bot-tui-collapsed.json')

writeFileSync(STATE, JSON.stringify({
  mainBotIds: ['bot-a'],
  revision: 1,
  bots: {
    'bot-a': { id: 'bot-a', name: 'Chief', role: 'Chief of Staff', model: 'p/a', sessionId: 'sess-a', segments: [], capabilities: [], main: true, sectionId: 'sec-1' },
    'bot-b': { id: 'bot-b', name: 'Dev', role: '编码', model: 'p/b', sessionId: 'sess-b', segments: [], capabilities: [], sectionId: 'sec-1' },
    'bot-c': { id: 'bot-c', name: 'Ops', role: '运维', model: 'p/c', sessionId: 'sess-c', segments: [], capabilities: [], sectionId: 'sec-2' },
    'bot-d': { id: 'bot-d', name: 'Temp', role: '临时', model: 'p/d', sessionId: 'sess-d', segments: [], capabilities: [] },
  },
  sections: [{ id: 'sec-1', name: '核心' }, { id: 'sec-2', name: '实验' }],
  capabilities: { items: {} },
}))

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
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
  stopChat: async () => true, ensureCapabilities: async () => {},
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
const focused = (term: any, rows: number) => screen(term, rows).split('\n').filter((line) => line.includes('❯')).join(' | ')
const fresh = () => rmSync(COLLAPSED, { force: true })

// A header can be focused and folded with the mouse-free pair; Enter toggles too.
{
  fresh()
  const { term, stdin, app } = await mount()
  const initial = await screen(term, 30)
  expect('the roster starts expanded', initial.includes('▾ 核心 (2)') && initial.includes('Chief') && initial.includes('Dev'), initial.slice(0, 400))

  stdin.write('k'); await wait(300)
  const header = await screen(term, 30)
  expect('the header row is focusable', focused(term, 30).includes('核心') && header.includes('▾ 核心 (2)'), focused(term, 30))

  stdin.write('\u001b[D'); await wait(400)
  const folded = await screen(term, 30)
  expect('Left folds the focused group', folded.includes('▸ 核心 (2)'), folded.slice(0, 500))
  expect('a folded group shows only title and count', !folded.includes('编码') && !folded.includes('Chief of Staff'), folded.slice(0, 600))
  expect('the header keeps the cursor', focused(term, 30).includes('▸ 核心'), focused(term, 30))

  stdin.write('\u001b[C'); await wait(400)
  const opened = await screen(term, 30)
  expect('Right opens it again', opened.includes('▾ 核心 (2)') && opened.includes('Dev'), opened.slice(0, 500))

  stdin.write('\r'); await wait(350)
  expect('Enter folds the focused header', (await screen(term, 30)).includes('▸ 核心 (2)'), '')
  stdin.write('\r'); await wait(350)
  expect('Enter opens it again', (await screen(term, 30)).includes('▾ 核心 (2)'), '')
  await app.unmount(); await wait(120)
}

// Folding the group under the cursor moves the cursor out; expanding restores
// the member it came from.
{
  fresh()
  const { term, stdin, app } = await mount()
  stdin.write('j'); await wait(300)
  expect('the cursor can stand on a member', focused(term, 30).includes('Dev'), focused(term, 30))

  stdin.write('\u001b[D'); await wait(400)
  const folded = await screen(term, 30)
  expect('Left on a member folds its group', folded.includes('▸ 核心 (2)') && !folded.includes('Dev'), folded.slice(0, 600))
  expect('the cursor leaves the folded group', focused(term, 30).includes('核心'), focused(term, 30))

  stdin.write('\u001b[C'); await wait(450)
  const restored = await screen(term, 30)
  expect('expanding restores the previous member', focused(term, 30).includes('Dev'), focused(term, 30))
  expect('the restored member is visible', restored.includes('▾ 核心 (2)') && restored.includes('Dev'), restored.slice(0, 500))
  await app.unmount(); await wait(120)
}

// Hidden members are not navigable at all.
{
  fresh()
  const { term, stdin, app } = await mount()
  stdin.write('k'); await wait(250)
  stdin.write('\u001b[D'); await wait(400)
  for (let at = 0; at < 4; at += 1) { stdin.write('j'); await wait(120) }
  const after = await screen(term, 30)
  const ring = focused(term, 30)
  expect('the cursor never lands on a hidden member', !ring.includes('Chief') && !ring.includes('Dev'), ring)
  expect('the other groups stay reachable', after.includes('Ops') && after.includes('Temp'), after.slice(0, 600))
  await app.unmount(); await wait(120)
}

// The collapsed set is terminal-local and survives a remount.
{
  fresh()
  const first = await mount()
  first.stdin.write('k'); await wait(250)
  first.stdin.write('\u001b[D'); await wait(450)
  await first.app.unmount(); await wait(150)

  let saved = ''
  try { saved = readFileSync(COLLAPSED, 'utf8') } catch { saved = '' }
  expect('the collapsed set is written under DSH_TUI_HOME', saved.includes('sec-1'), saved)

  const second = await mount()
  const reopened = await screen(second.term, 30)
  expect('a remount starts folded', reopened.includes('▸ 核心 (2)') && !reopened.includes('Dev'), reopened.slice(0, 600))
  await second.app.unmount(); await wait(120)
}

// Search expands every hit; leaving search puts the user's folds back.
{
  fresh()
  const first = await mount()
  first.stdin.write('k'); await wait(250)
  first.stdin.write('\u001b[D'); await wait(450)
  await first.app.unmount(); await wait(150)

  const { term, stdin, app } = await mount()
  const folded = await screen(term, 30)
  expect('the saved fold is in effect', folded.includes('▸ 核心 (2)') && !folded.includes('Dev'), folded.slice(0, 400))

  stdin.write('/'); await wait(250)
  stdin.write('Dev'); await wait(500)
  const found = await screen(term, 30)
  expect('search expands a matching folded group', found.includes('▾ 核心 (1)') && found.includes('Dev'), found.slice(0, 600))

  stdin.write('\u001b'); await wait(500)
  const restored = await screen(term, 30)
  expect('leaving search restores the fold', restored.includes('▸ 核心 (2)') && !restored.includes('Dev'), restored.slice(0, 600))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} collapse check(s) failed`)
  process.exit(1)
}
console.log('collapse checks passed')