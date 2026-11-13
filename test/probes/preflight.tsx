import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, bindHost, resetProbeHome,
} from './harness.mjs'
import { checkPreflight } from '../../src/preflight.js'

const ROOT = resetProbeHome('preflight')
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

const services = { commands: { register() {} }, tuiScenes: { register() {} } }
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  usageView: async () => ({ owners: [], rows: [] }),
}
const normal = { runtime: rt, services, team: { error: '' }, dsBotVersion: { version: '0.3.2', file: 'ds-bot/package.json' } }

// Pure checks: each failure has its own actionable line, and normal is silent.
{
  const ok = checkPreflight(normal)
  expect('normal preflight has no issues', ok.length === 0, JSON.stringify(ok))

  const missingRuntime = checkPreflight({ ...normal, runtime: undefined })
  expect('missing dsBot service is actionable', missingRuntime.some((issue) => issue.key === 'runtime' && issue.message.includes('未应用 dsBot 运行时补丁') && issue.message.includes('one-row patch')), JSON.stringify(missingRuntime))

  const badState = checkPreflight({ ...normal, team: { error: '读取团队失败：EACCES: permission denied' } })
  expect('unreadable state is actionable', badState.some((issue) => issue.key === 'state' && issue.message.includes('团队状态不可读') && issue.message.includes('state.json')), JSON.stringify(badState))

  const oldVersion = checkPreflight({ ...normal, dsBotVersion: { version: '0.4.0', file: 'ds-bot/package.json' } })
  expect('version mismatch is reported', oldVersion.some((issue) => issue.key === 'dsbot-version' && issue.message.includes('不在 0.3.x')), JSON.stringify(oldVersion))

  const unknownVersion = checkPreflight({ ...normal, dsBotVersion: null })
  expect('unknown DS Bot version stays out of the roster', unknownVersion.length === 0, JSON.stringify(unknownVersion))

  const missingServices = checkPreflight({ ...normal, services: {} })
  expect('missing host services are reported', missingServices.some((issue) => issue.key === 'services' && issue.message.includes('commands/tuiScenes')), JSON.stringify(missingServices))
}

async function mount(cols = 120, rows = 32) {
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

// Missing dsBot: the roster still renders, but says why creation is unavailable.
{
  resetProbeHome('preflight')
  bindRuntime(() => undefined)
  bindHost(() => services)
  const { term, app } = await mount()
  const view = await screen(term, 32)
  expect('missing dsBot shows the patch hint', view.includes('未应用 dsBot 运行时补丁') && view.includes('one-row patch'), view.slice(0, 1200))
  expect('missing dsBot marks creation unavailable', view.includes('c 新建（不可用）'), view.slice(-700))
  await app.unmount(); await wait(120)
}

// A broken state file is called out at the top with the file to inspect.
{
  resetProbeHome('preflight')
  writeFileSync(STATE, '{')
  bindRuntime(() => rt)
  bindHost(() => services)
  const { term, app } = await mount()
  const view = await screen(term, 32)
  expect('unreadable state shows an actionable banner', view.includes('团队状态不可读') && view.includes('state.json'), view.slice(0, 1200))
  expect('unreadable state disables creation', view.includes('创建不可用'), view.slice(-700))
  await app.unmount(); await wait(120)
}

// Everything present: no banner at all.
{
  resetProbeHome('preflight')
  bindRuntime(() => rt)
  bindHost(() => services)
  const { term, app } = await mount()
  const view = await screen(term, 32)
  expect('normal roster has no preflight banner', !view.includes('未应用 dsBot 运行时补丁') && !view.includes('团队状态不可读') && !view.includes('DS Bot 版本不确定') && !view.includes('必要服务不全'), view.slice(0, 1400))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} preflight check(s) failed`)
  process.exit(1)
}
console.log('preflight checks passed')
