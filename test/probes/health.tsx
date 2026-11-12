import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'

const ROOT = resetProbeHome('health')
const LOCK = join(ROOT, '.dsh', 'bot', 'state.lock')
const MOUNTS = join(ROOT, '.dsh-tui', 'session-mounts.json')
const FOREIGN_PID = process.ppid

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

let readOnly: string | undefined
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => readOnly,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  scheduleCapabilitiesReconcile: async () => {},
}
let service = true
bindRuntime(() => (service ? rt : undefined))

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

async function openHealth(stdin: any) {
  stdin.write('I'); await wait(500)
}

// Everything healthy: runtime, free lock, no foreign mounts, compatible TUI,
// patch present, native directory watch.
{
  readOnly = undefined
  service = true
  try { writeFileSync(LOCK, '') } catch {}
  try { writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [] })) } catch {}
  const { term, stdin, app } = await mount()
  await openHealth(stdin)
  const view = await screen(term, 30)
  expect('runtime is ready', view.includes('DS Bot 运行时') && view.includes('已就绪'), view.slice(0, 1200))
  expect('the team lock is free', view.includes('团队锁') && view.includes('空闲（可写）'), view.slice(0, 1200))
  expect('no foreign session is claimed', view.includes('没有其它终端占用会话'), view.slice(0, 1200))
  expect('the TUI version and range are shown', view.includes('dsh-TUI 版本') && view.includes('兼容范围 0.19.x'), view.slice(0, 1200))
  expect('the patch is applied', view.includes('运行时补丁') && view.includes('已应用（dsBot 服务存在）'), view.slice(0, 1200))
  expect('the watch is available', view.includes('名册监听') && view.includes('可用（目录监听）'), view.slice(0, 1200))
  await app.unmount(); await wait(120)
}

// Another host holds the team lock: the panel says read-only and how to clear it.
{
  readOnly = 'The Bot team is open in another dsh (Web or Desktop, pid ' + FOREIGN_PID + ').'
  service = true
  writeFileSync(LOCK, JSON.stringify({ pid: FOREIGN_PID, host: 'test-host', token: 'lock-token', since: Date.now() }))
  try { writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [] })) } catch {}
  const { term, stdin, app } = await mount()
  await openHealth(stdin)
  const view = await screen(term, 30)
  expect('a held lock is shown as read-only', view.includes('被占用（只读）'), view.slice(0, 1400))
  expect('the lock holder pid is shown', view.includes(`pid ${FOREIGN_PID}`), view.slice(0, 1400))
  expect('the lock advice is actionable', view.includes('关闭它或退出该进程'), view.slice(0, 1400))
  await app.unmount(); await wait(120)
}

// Sessions held by another terminal: pid, start time, and count.
{
  readOnly = undefined
  service = true
  try { writeFileSync(LOCK, '') } catch {}
  const startedAt = Date.now() - 3600_000
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [{ pid: FOREIGN_PID, startedAt, sessionIds: ['sess-one', 'sess-two'] }] }))
  const { term, stdin, app } = await mount()
  await openHealth(stdin)
  const view = await screen(term, 30)
  expect('foreign session claims are counted', view.includes('2 个会话被其它终端占用'), view.slice(0, 1400))
  expect('the owner pid and start time are shown', view.includes(`pid ${FOREIGN_PID}`) && view.includes('起始'), view.slice(0, 1400))
  await app.unmount(); await wait(120)
}

// No dsBot service: runtime and patch are missing; the lock is explicitly uncertain.
{
  readOnly = undefined
  service = false
  try { writeFileSync(LOCK, '') } catch {}
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [] }))
  const { term, stdin, app } = await mount()
  await openHealth(stdin)
  const view = await screen(term, 30)
  expect('a missing runtime is reported', view.includes('未就绪（dsBot 服务不存在）'), view.slice(0, 1400))
  expect('the lock is uncertain without the runtime', view.includes('不确定（运行时未就绪）'), view.slice(0, 1400))
  expect('the missing patch is reported', view.includes('未应用（dsBot 服务不存在）'), view.slice(0, 1400))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} health check(s) failed`)
  process.exit(1)
}
console.log('health checks passed')
