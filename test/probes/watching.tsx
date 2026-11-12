import { PassThrough, Writable } from 'node:stream'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  resetProbeHome, DEFAULT_STATE,
} from './harness.mjs'
import { watchTeam } from '../../src/watch.js'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

async function until(label: string, test: () => boolean, timeout = 2000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (test()) {
      expect(label, true)
      return
    }
    await wait(25)
  }
  expect(label, false, 'timed out')
}

const homeOf = (name: string) => join(resetProbeHome(name), '.dsh', 'bot')

function saveAtomic(statePath: string, state: unknown) {
  const temp = `${statePath}.${process.pid}.tmp`
  writeFileSync(temp, JSON.stringify(state))
  renameSync(temp, statePath)
}

// 1. A real directory watch re-reads after DS Bot's temp-file + rename write.
{
  const dir = homeOf('watch-real')
  const statePath = join(dir, 'state.json')
  let calls = 0
  const handle = watchTeam(() => { calls += 1 }, { home: dir, delay: 120, fallback: 5000 })
  // macOS reports the directory's existing entries once when the watch starts;
  // let that settle so the baseline is quiet before the write.
  await wait(300)
  const base = calls

  const next = JSON.parse(JSON.stringify(DEFAULT_STATE))
  next.bots['bot-live'] = { id: 'bot-live', name: 'LiveBot', role: '编码', model: 'p/c', sessionId: 'sess-live', segments: [], capabilities: [], instructions: '' }
  saveAtomic(statePath, next)
  await until('watch event triggers a re-read', () => calls > base)
  await wait(200)
  expect('watch delivers one debounced read', calls === base + 1, String(calls))
  handle.close()
  const afterClose = calls
  saveAtomic(statePath, { ...next, revision: 2 })
  await wait(400)
  expect('close stops the watcher', calls === afterClose, String(calls))
}

// 2. Idle: no per-second polling while the watch is healthy.
{
  const dir = homeOf('watch-idle')
  let calls = 0
  const handle = watchTeam(() => { calls += 1 }, { home: dir, delay: 120, fallback: 80 })
  await wait(300)
  const settled = calls
  await wait(400)
  expect('idle watch does not poll', calls === settled, `${settled} → ${calls}`)
  handle.close()
}

// 3. Many events inside the debounce window collapse into one read.
{
  const dir = homeOf('watch-debounce')
  let listener: (() => void) | undefined
  let closed = false
  const fake = (_home: string, _options: unknown, callback: () => void) => {
    listener = callback
    return { on: () => {}, close: () => { closed = true } }
  }
  let calls = 0
  const handle = watchTeam(() => { calls += 1 }, { home: dir, delay: 120, fallback: 5000, watchImpl: fake })
  for (let at = 0; at < 5; at += 1) listener?.()
  await wait(60)
  expect('debounce holds the read', calls === 0, String(calls))
  await wait(120)
  expect('debounce emits one read', calls === 1, String(calls))
  handle.close()
  expect('close closes the watcher', closed)
}

// 4. If watch() throws, poll at the fallback interval.
{
  const dir = homeOf('watch-throw')
  let calls = 0
  const handle = watchTeam(() => { calls += 1 }, {
    home: dir,
    fallback: 40,
    watchImpl: () => { throw new Error('unsupported') },
  })
  await wait(160)
  expect('fallback polls after a throw', calls >= 2, String(calls))
  const settled = calls
  handle.close()
  await wait(160)
  expect('close stops the fallback timer', calls === settled, String(calls))
}

// 5. If the watcher later errors, close it and poll instead.
{
  const dir = homeOf('watch-error')
  let handler: ((error: Error) => void) | undefined
  let closed = false
  const fake = () => ({
    on: (event: string, callback: (error: Error) => void) => {
      if (event === 'error') handler = callback
    },
    close: () => { closed = true },
  })
  let calls = 0
  const handle = watchTeam(() => { calls += 1 }, { home: dir, fallback: 40, watchImpl: fake })
  await wait(30)
  handler?.(new Error('watcher died'))
  await wait(160)
  expect('error event starts the fallback', calls >= 2, String(calls))
  expect('error event closes the watcher', closed)
  handle.close()
}

// 6. The scene itself picks the change up without the old one-second timer.
{
  const dir = homeOf('watch-scene')
  const rt = {
    live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
    resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
    sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
    stopChat: async () => true, ensureCapabilities: async () => {},
  }
  bindRuntime(() => rt)

  const cols = 100
  const rows = 30
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

  const before = viewportLines(term, rows).join('\n')
  expect('scene starts from state.json', before.includes('Chief') && !before.includes('LiveBot'), before.slice(0, 120))

  const statePath = join(dir, 'state.json')
  const next = JSON.parse(readFileSync(statePath, 'utf8'))
  next.bots['bot-live'] = { id: 'bot-live', name: 'LiveBot', role: '编码', model: 'p/c', sessionId: 'sess-live', segments: [], capabilities: [], instructions: '' }
  saveAtomic(statePath, next)
  await until('scene re-renders after an atomic write', () => viewportLines(term, rows).join('\n').includes('LiveBot'), 2000)

  await app.unmount(); await wait(150)
}

if (failures > 0) {
  console.log(`${failures} watch check(s) failed`)
  process.exit(1)
}
console.log('watch checks passed')