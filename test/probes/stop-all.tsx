import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  observe, resetProbeHome,
} from './harness.mjs'

resetProbeHome('stop-all')

const BOT_A = 'bot-a'
const BOT_B = 'bot-b'
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

let failId: string | undefined
let calls: string[] = []
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }),
  deleteBot: async () => {}, ensureCapabilities: async () => {},
  stopChat: async (id: string) => {
    calls.push(id)
    if (id === failId) throw new Error('停止超时')
    // The real runtime settles the turn when the stop lands; the roster reads
    // that from the session stream, so mirror it here.
    const sessionId = id === BOT_A ? SESSION_A : SESSION_B
    observe({ id: sessionId }, { type: 'turn/end', time: Date.now(), data: { reason: { kind: 'aborted' } } })
    return true
  },
}
bindRuntime(() => rt)

async function mount(cols = 120, rows = 34) {
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

// With nobody working, S only says so and calls nothing.
{
  calls = []
  const { term, stdin, app } = await mount()
  stdin.write('S'); await wait(400)
  const after = await screen(term, 34)
  expect('S with no working Bot says so', after.includes('没有正在工作的 Bot。'), after.slice(-300))
  expect('S with no working Bot calls nothing', calls.length === 0, JSON.stringify(calls))
  expect('S with no working Bot does not arm', !after.includes('停止全部'), after.slice(0, 300))
  await app.unmount(); await wait(120)
}

// The first S only arms the batch; it names every Bot that would stop.
{
  calls = []
  observe({ id: SESSION_A }, { type: 'turn/start', time: Date.now() - 5000 })
  observe({ id: SESSION_B }, { type: 'turn/start', time: Date.now() - 3000 })
  const { term, stdin, app } = await mount()
  const before = await screen(term, 34)
  expect('the roster counts both working Bots', before.includes('工作 2'), before.slice(0, 200))

  stdin.write('S'); await wait(400)
  const armed = await screen(term, 34)
  expect('the first S lists who would stop', armed.includes('停止全部 2 个工作中的 Bot：Chief、Dev'), armed.slice(0, 500))
  expect('the first S calls nothing', calls.length === 0, JSON.stringify(calls))

  stdin.write('\u001b'); await wait(400)
  const cancelled = await screen(term, 34)
  expect('Esc disarms without stopping', !cancelled.includes('停止全部') && calls.length === 0, JSON.stringify(calls))
  expect('the Bots are still working after cancel', cancelled.includes('工作 2'), cancelled.slice(0, 200))
  await app.unmount(); await wait(120)
}

// Confirming stops every working Bot, keeps going past a failure, and the
// roster follows.
{
  calls = []
  observe({ id: SESSION_A }, { type: 'turn/start', time: Date.now() - 5000 })
  observe({ id: SESSION_B }, { type: 'turn/start', time: Date.now() - 3000 })
  failId = BOT_A
  const { term, stdin, app } = await mount()
  stdin.write('S'); await wait(350)
  stdin.write('S'); await wait(900)
  const after = await screen(term, 34)
  const rowOf = (name: string) => after.split('\n').find((line) => line.includes(name) && (line.includes('空闲') || line.includes('工作中') || line.includes('待回答'))) ?? ''
  expect('both Bots are stopped even though the first fails', calls.includes(BOT_A) && calls.includes(BOT_B), JSON.stringify(calls))
  expect('the summary counts the success', after.includes('已停止 1 个'), after.slice(-400))
  expect('the summary names the failure', after.includes('失败 1 个（Chief：停止超时）'), after.slice(-400))
  expect('the stopped Bot leaves the working state', rowOf('Dev').includes('空闲'), rowOf('Dev'))
  expect('the failed Bot stays working', rowOf('Chief').includes('工作中'), rowOf('Chief'))
  await app.unmount(); await wait(120)
}

// A clean batch reports only successes.
{
  calls = []
  failId = undefined
  observe({ id: SESSION_A }, { type: 'turn/start', time: Date.now() - 5000 })
  observe({ id: SESSION_B }, { type: 'turn/start', time: Date.now() - 3000 })
  const { term, stdin, app } = await mount()
  stdin.write('S'); await wait(350)
  stdin.write('S'); await wait(900)
  const after = await screen(term, 34)
  expect('a clean batch stops both', calls.length === 2 && calls.includes(BOT_A) && calls.includes(BOT_B), JSON.stringify(calls))
  expect('the summary counts two', after.includes('已停止 2 个'), after.slice(-400))
  expect('the summary reports no failure', !after.includes('失败'), after.slice(-400))
  expect('the roster is idle afterwards', !after.includes('工作中'), after.slice(0, 400))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} stop-all check(s) failed`)
  process.exit(1)
}
console.log('stop-all checks passed')