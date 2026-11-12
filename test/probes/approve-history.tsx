import { PassThrough, Writable } from 'node:stream'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'
import { approvalHistory, resetApprovalHistory } from '../../src/approvalHistory.js'

const ROOT = resetProbeHome('approve-history')
resetApprovalHistory()

const BOT_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const openEntry = () => ({
  id: 'ap-1',
  sessionId: 'sess-a',
  botId: 'bot-a',
  tool: 'project-fs',
  reason: '读取项目文件',
  at: Date.now() - 60000,
})

function harness(options: { withListener?: boolean } = {}) {
  const calls: string[] = []
  let pending = [openEntry()]
  let listener: ((kind: string, data: any) => void) | undefined
  const rt: Record<string, unknown> = {
    live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
    resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
    sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
    stopChat: async () => true, ensureCapabilities: async () => {},
    approvalsView: () => pending,
    answerApproval: (id: string, choice: string) => {
      calls.push(`answer:${id}:${choice}`)
      pending = pending.filter((entry) => entry.id !== id)
      if (options.withListener !== false) {
        listener?.('settled', { id, outcome: choice === 'allow' ? 'allowed-once' : 'rejected' })
      }
    },
  }
  if (options.withListener !== false) {
    rt.onApproval = (fn: (kind: string, data: any) => void) => {
      listener = fn
      return () => { listener = undefined }
    }
  }
  bindRuntime(() => rt)
  return { rt, calls, emit: (kind: string, data: any) => listener?.(kind, data) }
}

async function mount(cols = 100, rows = 30) {
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

// Empty history and the h toggle.
{
  const statePath = join(ROOT, '.dsh', 'bot', 'state.json')
  const before = readFileSync(statePath, 'utf8')
  harness()
  const { term, stdin, app } = await mount()
  stdin.write('a'); await wait(350)
  const pending = await screen(term, 30)
  expect('a opens the pending view', pending.includes('待审批') && pending.includes('project-fs'), pending.slice(0, 160))

  stdin.write('h'); await wait(350)
  const empty = await screen(term, 30)
  expect('h opens the history view', empty.includes('已决审批') && empty.includes('本终端还没有已决审批'), empty.slice(0, 200))
  expect('empty history says it is terminal-local', empty.includes('只记录本终端回答的请求'))

  stdin.write('h'); await wait(350)
  const back = await screen(term, 30)
  expect('h toggles back to pending', back.includes('待审批') && !back.includes('已决审批'), back.slice(0, 160))

  expect('history is not written to state.json', readFileSync(statePath, 'utf8') === before)
  await app.unmount(); await wait(120)
}

// A settled request appears with its time, target, request and outcome.
{
  resetApprovalHistory()
  const { emit } = harness()
  const { term, stdin, app } = await mount()
  stdin.write('a'); await wait(300)

  emit('open', openEntry())
  emit('settled', { id: 'ap-1', outcome: 'allowed-once' })
  await wait(120)
  expect('settled request enters the local history', approvalHistory().length === 1, String(approvalHistory().length))

  stdin.write('h'); await wait(350)
  const history = await screen(term, 30)
  expect('history lists the outcome', history.includes('允许'), history.slice(0, 200))
  expect('history lists the request', history.includes('project-fs') && history.includes('读取项目文件'))
  expect('history names the Bot', history.includes('Chief'))
  expect('history shows a time', /\d{4}\/\d{1,2}\/\d{1,2}/.test(history), history.slice(0, 200))
  expect('history footer drops the pending actions', history.includes('h 返回待审批') && !history.includes('x 拒绝'), history.slice(0, 200))
  console.log('--- history ---')
  for (const line of history.split('\n').slice(0, 16)) console.log('|' + line + '|')
  await app.unmount(); await wait(120)
}

// A rejected request keeps its outcome.
{
  resetApprovalHistory()
  const { emit } = harness()
  const { stdin, app } = await mount()
  stdin.write('a'); await wait(300)
  emit('open', openEntry())
  emit('settled', { id: 'ap-1', outcome: 'rejected' })
  await wait(120)
  stdin.write('h'); await wait(350)
  expect('rejected request is recorded', approvalHistory()[0]?.outcome === 'rejected', JSON.stringify(approvalHistory()[0]))
  await app.unmount(); await wait(120)
}

// Without DS Bot's settled event, the TUI answer itself is recorded.
{
  resetApprovalHistory()
  const { calls } = harness({ withListener: false })
  const { term, stdin, app } = await mount()
  stdin.write('a'); await wait(300)
  stdin.write('\r'); await wait(400)
  expect('enter answers the request', calls.some((call) => call === 'answer:ap-1:allow'), calls.join(','))
  expect('the answer is recorded locally', approvalHistory().some((row) => row.outcome === 'allowed-once' && row.tool === 'project-fs'), JSON.stringify(approvalHistory()))

  stdin.write('h'); await wait(350)
  const history = await screen(term, 30)
  expect('fallback history renders', history.includes('允许') && history.includes('project-fs'), history.slice(0, 200))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} approval-history check(s) failed`)
  process.exit(1)
}
console.log('approval-history checks passed')