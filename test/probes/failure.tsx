import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  observe, activityOf, resetProbeHome,
} from './harness.mjs'

resetProbeHome('failure')

const BOT_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const BOT_B = 'sess-b'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const calls: string[] = []
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }),
  deleteBot: async (id: string) => { calls.push(`delete:${id}`) },
  stopChat: async () => true, ensureCapabilities: async () => {},
}
bindRuntime(() => rt)

const now = Date.now()
const fail = (id: string, message: string, code: string, at = now - 30000) => {
  observe({ id }, { type: 'turn/start', time: at - 30000 })
  observe({ id }, { type: 'turn/end', time: at, data: { reason: { kind: 'error', error: { message, code } } } })
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
  await wait(450)
  return { term, stdin, app }
}

const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')

// The record comes from turn/end, with the time, message and source type.
{
  fail(BOT_A, '模型路由不可用', 'LLM/UNAVAILABLE')
  const record = activityOf(BOT_A)
  expect('failure is recorded', record?.failure !== undefined, JSON.stringify(record?.failure))
  expect('failure keeps the time', record.failure?.at === now - 30000, String(record.failure?.at))
  expect('failure keeps the message', record.failure?.reason === '模型路由不可用', String(record.failure?.reason))
  expect('failure names its source event', record.failure?.source === 'turn/end', String(record.failure?.source))

  observe({ id: BOT_B }, { type: 'turn/end', time: now, data: { reason: { kind: 'error', error: { code: 'E/Code' } } } })
  expect('a code-only failure still reads', activityOf(BOT_B)?.failure?.reason === 'E/Code', JSON.stringify(activityOf(BOT_B)?.failure))
  observe({ id: BOT_B }, { type: 'turn/end', time: now + 1, data: { reason: { kind: 'completed' } } })
  expect('a successful turn clears the record', activityOf(BOT_B)?.failure === undefined)
}

// The roster row carries the marker; a recovered Bot does not.
{
  fail(BOT_A, '模型路由不可用', 'LLM/UNAVAILABLE')
  const { term, app } = await mount(80, 24)
  const narrow = await screen(term, 24)
  const lines = narrow.split('\n')
  expect('the failed row is marked', lines.some((line) => line.includes('Chief') && line.includes('!失败')), narrow.slice(0, 240))
  expect('the recovered row is not marked', lines.some((line) => line.includes('Dev') && !line.includes('!失败')))
  expect('narrow detail names the failure', narrow.includes('!失败') && narrow.includes('模型路由不可用'))
  await app.unmount(); await wait(120)
}

// The wide detail shows the reason, the source and the clear action.
{
  const { term, app } = await mount(120, 34)
  const wide = await screen(term, 34)
  expect('the detail shows the reason', wide.includes('原因 模型路由不可用'), wide.slice(0, 500))
  expect('the detail shows the source', wide.includes('来源 turn/end'))
  expect('the detail offers a clear action', wide.includes('X 清除'))
  await app.unmount(); await wait(120)
}

// A failure that arrives while the roster is open appears without a remount.
{
  observe({ id: BOT_A }, { type: 'turn/end', time: now + 2, data: { reason: { kind: 'completed' } } })
  const { term, app } = await mount(120, 34)
  expect('no marker after recovery', !(await screen(term, 34)).includes('!失败'))
  fail(BOT_A, '工具调用超时', 'TOOL/TIMEOUT', Date.now())
  await wait(300)
  const live = await screen(term, 34)
  expect('the marker appears live', live.includes('!失败') && live.includes('工具调用超时'), live.slice(0, 240))
  await app.unmount(); await wait(120)
}

// A successful turn clears it; X clears it explicitly without deleting.
{
  fail(BOT_A, '模型路由不可用', 'LLM/UNAVAILABLE')
  const { term, stdin, app } = await mount(120, 34)
  expect('failure is visible before recovery', (await screen(term, 34)).includes('!失败'))

  observe({ id: BOT_A }, { type: 'turn/end', time: Date.now(), data: { reason: { kind: 'completed' } } })
  await wait(300)
  expect('a successful turn clears the record', activityOf(BOT_A)?.failure === undefined, JSON.stringify(activityOf(BOT_A)?.failure))
  expect('the marker disappears', !(await screen(term, 34)).includes('!失败'))

  fail(BOT_B, '磁盘写入失败', 'FS/WRITE', Date.now())
  stdin.write('j'); await wait(300)
  stdin.write('X'); await wait(350)
  const cleared = await screen(term, 34)
  expect('X clears the selected failure', activityOf(BOT_B)?.failure === undefined, JSON.stringify(activityOf(BOT_B)?.failure))
  expect('X says what it did', cleared.includes('已清除'), cleared.slice(-200))
  expect('X does not delete the Bot', cleared.includes('Dev') && !calls.some((call) => call === `delete:${BOT_B}`))

  stdin.write('x'); await wait(350)
  const confirm = await screen(term, 34)
  expect('x still asks before deleting', confirm.includes('再按一次 x 删除') && confirm.includes('Dev'), confirm.slice(-240))
  expect('x did not delete the Bot', !calls.some((call) => call === `delete:${BOT_B}`))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} failure check(s) failed`)
  process.exit(1)
}
console.log('failure checks passed')