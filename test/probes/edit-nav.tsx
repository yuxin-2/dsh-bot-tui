import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'

const ROOT = resetProbeHome('edit-nav')

const STATE = join(ROOT, '.dsh', 'bot', 'state.json')
writeFileSync(STATE, JSON.stringify({
  mainBotIds: ['bot-a'],
  revision: 1,
  bots: {
    'bot-a': { id: 'bot-a', name: 'Chief', role: 'Chief of Staff', model: 'p/a', sessionId: 'sess-a', segments: [], capabilities: [], main: true, instructions: 'lead the team', workDir: join(ROOT, 'work') },
    'bot-b': { id: 'bot-b', name: 'Dev', role: '编码', model: 'p/b', sessionId: 'sess-b', segments: [], capabilities: [], instructions: '' },
  },
  rooms: {
    'room-1': { id: 'room-1', name: 'Dev + Tui', members: ['bot-a', 'bot-b'], admin: 'bot-a', mode: 'admin', createdAt: 1 },
  },
  capabilities: { items: {} },
}))
writeFileSync(join(ROOT, 'avatar.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64'))


const wait = (ms: number) => new Promise(r => setTimeout(r, ms))
const calls: string[] = []
const catalog = [
  { ref: 'p/a', provider: 'p', providerName: 'P', id: 'a', name: 'Model A' },
  { ref: 'p/b', provider: 'p', providerName: 'P', id: 'b', name: 'Model B' },
]
const approvals = [{ id: 'ap-1', sessionId: 'sess-b', botId: 'bot-b', tool: 'project-fs', reason: '需要读取项目文件', at: Date.now(), answerable: true }]
const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  scheduleCapabilitiesReconcile: async () => {},
  createBot: async (o: any) => { calls.push('createBot:' + JSON.stringify(o)); return { id: 'bot-new', name: o.name } },
  deleteBot: async (id: string) => { calls.push('deleteBot:' + id) },
  duplicateBot: async (id: string) => { calls.push('duplicate:' + id); return { id: 'bot-copy', name: 'Copy' } },
  updateBot: async (id: string, patch: any) => { calls.push('updateBot:' + id + ':' + JSON.stringify(patch)) },
  setFlags: async (id: string, patch: any) => { calls.push('setFlags:' + id + ':' + JSON.stringify(patch)) },
  setMain: async (id: string, main: boolean) => { calls.push('setMain:' + id + ':' + main) },
  createRoom: async (o: any) => { calls.push('createRoom:' + JSON.stringify(o)); return { id: 'room-2', name: '新群' } },
  updateRoom: async (id: string, patch: any) => { calls.push('updateRoom:' + id + ':' + JSON.stringify(patch)); return {} },
  deleteRoom: async (id: string) => { calls.push('deleteRoom:' + id) },
  catalog: async () => catalog,
  cachedCatalog: () => catalog,
  capabilityLibraryView: () => [],
  capabilityStatusesView: () => ({}),
  approvalsView: () => approvals,
  answerApproval: (id: string, choice: string) => { calls.push('answer:' + id + ':' + choice) },
  scheduleEndpoint: async (endpoint: string, body: any) => {
    calls.push('schedule:' + endpoint + ':' + JSON.stringify(body))
    if (endpoint === 'schedules') return { available: true, tasks: [{ id: 't1', sessionId: 'sess-a', botId: 'bot-a', title: '早间简报', kind: 'daily', time: '09:00:00', state: 'scheduled', scheduledAt: Date.now() + 3600000 }] }
    return { tasks: [] }
  },
  memoryEndpoint: async (endpoint: string, body: any) => {
    calls.push('memory:' + endpoint + ':' + JSON.stringify(body))
    if (endpoint === 'memory-view') return { entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }], summary: { text: '偏好简洁' } }
    if (endpoint === 'memory-ask') return { reply: '好的，已记录。', changes: [{ op: 'add', text: '喜欢简洁回答', ok: true }], entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }, { id: 'm2', scope: 'own', topic: '偏好', text: '新增条目', pinned: false }], summary: { text: '偏好简洁' } }
    if (endpoint === 'memory-pin') return { entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: body.pin === true }] }
    return { entries: [] }
  },
  usageView: async () => ({
    owners: [
      { key: 'bot-a', kind: 'bot', id: 'bot-a', name: 'Chief' },
      { key: 'bot-b', kind: 'bot', id: 'bot-b', name: 'Dev' },
    ],
    rows: [
      [0, 0, 0, 'chat', 1000, 200, 50, 300, 3],
      [0, 1, 0, 'chat', 500, 100, 20, 100, 1],
    ],
  }),
}
bindRuntime(() => rt)

async function run(label: string, keys: string[]) {
  calls.length = 0
  const term = new XTerm({ cols: 90, rows: 30, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = 90; rows = 30; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: 'sess-a', provider: 'p', model: 'a', resumeTo: async (id: string) => { calls.push('resume:' + id); return { ok: true } }, submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => calls.push('close') })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(350)
  for (const k of keys) { stdin.write(k); await wait(400) }
  await wait(500)
  console.log(`=== ${label} ===`)
  for (const l of viewportLines(term, 30).slice(0, 22)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls))
  await app.unmount(); await wait(100)
}

await run('nav', ['e', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j'])

