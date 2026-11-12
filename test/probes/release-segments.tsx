import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'

const ROOT = resetProbeHome('release-segments')

const BOT = 'bot-dev'
const CUR = 'sess-cur'
const OLD = 'sess-old'
const MOUNTS = join(ROOT, '.dsh-tui', 'session-mounts.json')
const STATE = join(ROOT, '.dsh', 'bot', 'state.json')

function writeState(bots: any, capabilities: any = { items: {} }) {
  writeFileSync(STATE, JSON.stringify({
    mainBotIds: [BOT],
    revision: 1,
    bots,
    capabilities,
  }))
}

writeState({
  [BOT]: {
    id: BOT, name: 'Dev', role: '编码', model: 'magpie/x',
    sessionId: CUR, segments: [{ sessionId: OLD }],
    capabilities: ['echo'], main: true,
  },
})


const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

async function mountScene(channel: any, rt: any) {
  bindRuntime(() => rt)
  const term = new XTerm({ cols: 80, rows: 24, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = 80; rows = 24; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(400)
  return { term, stdin, app }
}

const baseRt = (calls: string[]) => ({
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'x', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
  stopChat: async () => true,
  ensureCapabilities: async (id: string) => { calls.push('ensure:' + id) },
  capabilityEndpoint: async (e: string, body: any) => { calls.push(`cap:${e}:${JSON.stringify(body)}`) },
  capabilityLibraryView: () => [{ name: 'echo', kind: 'mcp', transport: 'stdio', approved: true, description: 'echo' }],
})

// A: this terminal holds both the current session and an old segment.
{
  const calls: string[] = []
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [{ pid: process.pid, startedAt: Date.now(), sessionIds: [CUR, OLD] }] }))
  const channel = { sessionId: CUR, provider: 'p', model: 'm', resumeTo: async () => ({ ok: true }), submit: () => {},
    stopBackgroundAgent: async (id: string) => { calls.push('stopBg:' + id); return true } }
  const { term, stdin, app } = await mountScene(channel, baseRt(calls))
  stdin.write('u'); await wait(600)
  console.log('=== release current + old segment ===')
  for (const l of viewportLines(term, 24).slice(0, 12)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls))
  await app.unmount(); await wait(100)
}

// B: another live process holds the old segment.
{
  const calls: string[] = []
  const { spawn } = await import('node:child_process')
  const sleeper = spawn('sleep', ['20'])
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [{ pid: sleeper.pid, startedAt: Date.now(), sessionIds: [OLD] }] }))
  const channel = { sessionId: CUR, provider: 'p', model: 'm', resumeTo: async () => ({ ok: true }), submit: () => {},
    stopBackgroundAgent: async (id: string) => { calls.push('stopBg:' + id); return true } }
  const { term, stdin, app } = await mountScene(channel, baseRt(calls))
  stdin.write('u'); await wait(600)
  console.log('=== foreign holder on old segment ===')
  for (const l of viewportLines(term, 24).slice(0, 12)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls))
  await app.unmount(); await wait(100)
  sleeper.kill('SIGKILL')
}

// C: approve must not eagerly mount for offline Bots.
{
  writeState(
    { [BOT]: { id: BOT, name: 'Dev', role: '编码', model: 'magpie/x', sessionId: CUR, segments: [], capabilities: ['echo'], main: true } },
    { items: { echo: { name: 'echo', kind: 'mcp', transport: 'stdio', approved: false, description: 'echo' } } })
  writeFileSync(MOUNTS, JSON.stringify({ version: 1, owners: [] }))
  const calls: string[] = []
  const channel = { sessionId: CUR, provider: 'p', model: 'm', resumeTo: async () => ({ ok: true }), submit: () => {},
    stopBackgroundAgent: async () => true }
  const rt = { ...baseRt(calls), capabilityLibraryView: () => [] }
  const { term, stdin, app } = await mountScene(channel, rt)
  stdin.write('p'); await wait(350)
  console.log('=== approve view (pending echo) ===')
  for (const l of viewportLines(term, 24).slice(0, 14)) console.log('|' + l + '|')
  stdin.write('\r'); await wait(700)
  console.log('=== approve pending (no eager ensure) ===')
  for (const l of viewportLines(term, 24).slice(0, 12)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls))
  await app.unmount()
}