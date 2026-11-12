import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'

resetProbeHome('schedule-status')

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const clock = (value: string | number | Date) => {
  const at = new Date(value)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

const nextAt = new Date(Date.now() + 3600_000).toISOString()
const deliveredAt = new Date(Date.now() - 1800_000).toISOString()
let tasks: any[] = []

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  scheduleCapabilitiesReconcile: async () => {},
  catalog: async () => [], cachedCatalog: () => [],
  reasoningOf: async () => ({ efforts: [] }),
  permissionCatalog: () => ({ options: [], defaultPreset: undefined }),
  capabilityLibraryView: () => [], capabilityStatusesView: () => ({}),
  computerEnabled: () => false, computerView: () => ({}),
  usageView: async () => ({ rows: [] }), memoryEndpoint: async () => ({ entries: [] }),
  scheduleEndpoint: async (endpoint: string) => {
    if (endpoint === 'schedules') return { available: true, tasks }
    return { tasks: [] }
  },
}
bindRuntime(() => rt)

async function mount(cols = 100, rows = 30) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}

const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')

async function openSchedules(stdin: any) {
  stdin.write('e'); await wait(300)
  for (let at = 0; at < 17; at += 1) { stdin.write('j'); await wait(120) }
  stdin.write('\r'); await wait(500)
}

// Next firing and a last-delivery receipt; the receipt is not a turn result.
{
  tasks = [{
    id: 't1', sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', botId: 'bot-a',
    title: '早间简报', kind: 'daily', time: '09:00:00', state: 'scheduled',
    scheduledAt: nextAt,
    lastDelivery: { scheduledAt: deliveredAt, deliveredAt, messageId: 'm1', targetSessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7' },
    prompt: '汇总昨天的进展',
  }]
  const { term, stdin, app } = await mount()
  await openSchedules(stdin)
  const view = await screen(term, 30)
  expect('the next firing time is shown', view.includes(`下次 ${clock(nextAt)}`), view.slice(-700))
  expect('a recorded delivery time is shown', view.includes(`最近投递 ${clock(deliveredAt)}`), view.slice(-700))
  expect('the turn result is explicitly unavailable', view.includes('执行结果 不可用'), view.slice(-700))
  await app.unmount(); await wait(120)
}

// No scheduledAt and no receipt: every runtime-backed field says unavailable.
{
  tasks = [{
    id: 't2', sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', botId: 'bot-a',
    title: '没有状态', kind: 'daily', time: '10:00:00', state: 'scheduled',
    prompt: '什么都不做',
  }]
  const { term, stdin, app } = await mount()
  await openSchedules(stdin)
  const view = await screen(term, 30)
  expect('a missing next firing is unavailable', view.includes('下次 不可用'), view.slice(-700))
  expect('a missing delivery is unavailable', view.includes('最近投递 不可用'), view.slice(-700))
  expect('a missing result is unavailable', view.includes('执行结果 不可用'), view.slice(-700))
  await app.unmount(); await wait(120)
}

// A long title is truncated in the row, but the selected task's full prompt is
// rendered in the detail block below the list.
{
  const longTitle = '这是一个非常非常长的定时任务名称用来验证列表行会被截断而且不会换行'
  const promptLine = '完整指令第一行：把今天所有 Bot 的进展、阻塞和下一步整理成一段简报。'
  const secondLine = '完整指令第二行：只列事实，不要猜测。'
  tasks = [{
    id: 't3', sessionId: 'eeeef6cd-c770-47f7-a467-9173bb5b65f7', botId: 'bot-a',
    title: longTitle, kind: 'daily', time: '11:00:00', state: 'scheduled',
    scheduledAt: nextAt, prompt: `${promptLine}\n${secondLine}`,
  }]
  const { term, stdin, app } = await mount()
  await openSchedules(stdin)
  const lines = (await screen(term, 30)).split('\n')
  const row = lines.find((line) => line.includes('❯ ') && line.includes('…'))
  expect('a long task row is truncated', row !== undefined && !row.includes(longTitle), row ?? 'no truncated row')
  const view = lines.join('\n')
  expect('the detail shows the full prompt line', view.includes(promptLine), view.slice(-900))
  expect('the detail keeps later prompt lines', view.includes(secondLine), view.slice(-900))
  await app.unmount(); await wait(120)
}

// An empty task list keeps its explicit empty state.
{
  tasks = []
  const { term, stdin, app } = await mount()
  await openSchedules(stdin)
  const view = await screen(term, 30)
  expect('an empty task list is explicit', view.includes('没有定时任务 · 按 n 新建'), view.slice(-500))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} schedule status check(s) failed`)
  process.exit(1)
}
console.log('schedule status checks passed')
