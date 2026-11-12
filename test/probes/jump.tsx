import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  observe, resetProbeHome,
} from './harness.mjs'

const ROOT = resetProbeHome('jump')
const STATE = join(ROOT, '.dsh', 'bot', 'state.json')

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const state = (bots: any[]) => {
  writeFileSync(STATE, JSON.stringify({
    mainBotIds: ['bot-a'],
    revision: 1,
    bots,
    sections: [{ id: 'sec-1', name: '核心' }, { id: 'sec-2', name: '实验' }],
    capabilities: { items: {} },
  }))
}
const bot = (id: string, name: string, sessionId: string, sectionId?: string) => ({
  id, name, role: name, model: 'p/a', sessionId, segments: [], capabilities: [], ...(sectionId === undefined ? {} : { sectionId }),
})

state([
  bot('bot-a', 'Chief', 'sess-a', 'sec-1'),
  bot('bot-b', 'Dev', 'sess-b', 'sec-1'),
  bot('bot-c', 'Ops', 'sess-c', 'sec-2'),
  bot('bot-d', 'Temp', 'sess-d'),
])

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

// Two needs-input Bots and two unread Bots: g/G walk forward and wrap.
{
  observe({ id: 'sess-b' }, { type: 'approval/asked', time: Date.now() })
  observe({ id: 'sess-d' }, { type: 'approval/asked', time: Date.now() })
  observe({ id: 'sess-b' }, { type: 'assistant/message', time: Date.now() - 1000, data: { message: { content: [{ type: 'text', text: 'B 回复了' }] } } })
  observe({ id: 'sess-c' }, { type: 'assistant/message', time: Date.now() - 2000, data: { message: { content: [{ type: 'text', text: 'C 回复了' }] } } })

  const { term, stdin, app } = await mount()
  const initial = await screen(term, 30)
  expect('the footer counts what needs attention', initial.includes('还有 2 个待回答 / 2 个新回复'), initial.slice(-500))
  expect('the first Bot is focused', focused(term, 30).includes('Chief'), focused(term, 30))

  stdin.write('g'); await wait(300)
  expect('g jumps to the next needs-input Bot', focused(term, 30).includes('Dev'), focused(term, 30))

  stdin.write('g'); await wait(300)
  expect('g keeps walking forward', focused(term, 30).includes('Temp'), focused(term, 30))

  stdin.write('g'); await wait(300)
  expect('g wraps to the first target', focused(term, 30).includes('Dev'), focused(term, 30))

  stdin.write('G'); await wait(300)
  expect('G jumps to the next unread Bot', focused(term, 30).includes('Ops'), focused(term, 30))

  stdin.write('G'); await wait(300)
  expect('G wraps too', focused(term, 30).includes('Dev'), focused(term, 30))
  await app.unmount(); await wait(120)
}

// No targets: g/G only say so and leave the cursor alone.
{
  state([
    bot('bot-e', 'Solo', 'sess-e', 'sec-1'),
    bot('bot-f', 'Quiet', 'sess-f', 'sec-2'),
  ])
  const { term, stdin, app } = await mount()
  const before = focused(term, 30)
  expect('no targets means no footer count', !screen(term, 30).includes('还有'), screen(term, 30).slice(-300))

  stdin.write('g'); await wait(350)
  let after = await screen(term, 30)
  expect('g with no needs-input says so', after.includes('没有待回答的 Bot。'), after.slice(-400))
  expect('g with no needs-input does not move', focused(term, 30) === before, focused(term, 30))

  stdin.write('G'); await wait(350)
  after = await screen(term, 30)
  expect('G with no unread says so', after.includes('没有新回复的 Bot。'), after.slice(-400))
  expect('G with no unread does not move', focused(term, 30) === before, focused(term, 30))
  await app.unmount(); await wait(120)
}

// Jumps see only visible rows: folded members and filtered-out Bots are skipped.
{
  state([
    bot('bot-a', 'Chief', 'sess-a', 'sec-1'),
    bot('bot-b', 'Dev', 'sess-b', 'sec-1'),
    bot('bot-c', 'Ops', 'sess-c', 'sec-2'),
    bot('bot-d', 'Temp', 'sess-d'),
  ])
  const { term, stdin, app } = await mount()

  // Fold the first group from its header.
  stdin.write('k'); await wait(250)
  stdin.write('\u001b[D'); await wait(450)
  const folded = await screen(term, 30)
  expect('the first group is folded', folded.includes('▸ 核心 (2)'), folded.slice(0, 400))

  stdin.write('g'); await wait(350)
  expect('g skips a folded needs-input Bot', focused(term, 30).includes('Temp') && !focused(term, 30).includes('Dev'), focused(term, 30))

  stdin.write('G'); await wait(350)
  expect('G skips a folded unread Bot', focused(term, 30).includes('Ops'), focused(term, 30))

  // Search leaves only Chief; neither target is visible.
  stdin.write('/'); await wait(250)
  stdin.write('Chief'); await wait(450)
  stdin.write('\r'); await wait(350)
  const filtered = await screen(term, 30)
  expect('search keeps only the hit', filtered.includes('▾ 核心 (1)') && !filtered.includes('Dev'), filtered.slice(0, 500))

  const before = focused(term, 30)
  stdin.write('g'); await wait(350)
  const noAnswer = await screen(term, 30)
  expect('g respects the filter', noAnswer.includes('没有待回答的 Bot。'), noAnswer.slice(-400))
  expect('g under a filter does not move', focused(term, 30) === before, focused(term, 30))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} jump check(s) failed`)
  process.exit(1)
}
console.log('jump checks passed')