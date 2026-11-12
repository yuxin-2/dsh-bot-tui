import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'
const ROOT = resetProbeHome('release')
const CHIEF = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'
const CHIEF_SESSION = 'eec9cc52-6a65-4e8a-9bc0-e254226d9576'
const MOUNTS = `${ROOT}/.dsh-tui/session-mounts.json`

const calls: string[] = []
const rt = {
  live: new Map([[CHIEF_SESSION, {}]]),
  load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'x', syncModels: () => {},
  sendUser: async (a: any) => { calls.push('sendUser:' + a.sessionId) },
  createBot: async (o: any) => { calls.push('create'); return { id: 'n' } },
  deleteBot: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  capabilityEndpoint: async () => ({}),
}
bindRuntime(() => rt)

async function run(label: string, ownerPid: number, keys: string[]) {
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [{ pid: ownerPid, startedAt: Date.now(), sessionIds: [CHIEF_SESSION] }] }))
  const term = new XTerm({ cols: 80, rows: 24, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = 80; rows = 24; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: CHIEF, provider: 'magpie', model: 'nas/deepseek-v4.1-flash', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async (id: string) => { calls.push('stopBg:' + id); return true } }
  calls.length = 0
  const app = await render(React.createElement(ThemeProvider, { theme: 'dark' }, React.createElement(TeamScene, { React, ui, channel, close: () => {} })), { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
  await wait(350)
  for (const k of keys) { stdin.write(k); await wait(250) }
  await wait(1100)
  console.log(`=== ${label} ===`)
  for (const l of viewportLines(term, 24).slice(0, 14)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls)); console.log('')
  await app.unmount()
}
const { spawn } = await import('node:child_process')
const sleeper = spawn('sleep', ['30'])
const otherPid = sleeper.pid ?? 999999
await run('foreign holder', otherPid, [])
await run('foreign holder + u', otherPid, ['u'])
await run('this terminal holds it (background) + u', process.pid, ['u'])
await run('live bot: m sends directly', 999999, ['m', 'hi', '\r'])
try { sleeper.kill('SIGKILL') } catch {}
