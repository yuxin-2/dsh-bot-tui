import { PassThrough, Writable } from 'node:stream'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, observe, install, resetProbeHome } from './harness.mjs'

const ROOT = resetProbeHome('nav')

const STATE = join(ROOT, '.dsh', 'bot', 'state.json')
writeFileSync(STATE, JSON.stringify({
  mainBotIds: ['bot-a'],
  revision: 1,
  bots: {
    'bot-a': { id: 'bot-a', name: 'Chief', role: 'Chief of Staff', model: 'p/a', sessionId: 'sess-a', segments: [], capabilities: [], main: true, instructions: 'lead the team', workDir: join(ROOT, 'work'), sectionId: 'sec-1', browserGrants: [{ site: 'zoom.us', kinds: ['post'] }] },
    'bot-b': { id: 'bot-b', name: 'Dev', role: '编码', model: 'p/b', sessionId: 'sess-b', segments: [], capabilities: [], instructions: '' },
  },
  rooms: {
    'room-1': { id: 'room-1', name: 'Dev + Tui', members: ['bot-a', 'bot-b'], admin: 'bot-a', mode: 'admin', createdAt: 1 },
  },
  sections: [{ id: 'sec-1', name: '核心' }, { id: 'sec-2', name: '实验' }],
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
  reasoningOf: async () => ({ efforts: [{ id: 'off', name: '关' }, { id: 'low', name: '低' }, { id: 'high', name: '高', description: '更深入地思考' }] }),
  cachedCatalog: () => catalog,
  capabilityLibraryView: () => [],
  capabilityStatusesView: () => ({}),
  approvalsView: () => approvals,
  answerApproval: (id: string, choice: string) => { calls.push('answer:' + id + ':' + choice) },
  scheduleEndpoint: async (endpoint: string, body: any) => {
    calls.push('schedule:' + endpoint + ':' + JSON.stringify(body))
    if (endpoint === 'schedules') return { available: true, tasks: [
      { id: 't1', sessionId: 'sess-a', botId: 'bot-a', title: '早间简报', kind: 'daily', time: '09:00:00', state: 'scheduled', scheduledAt: Date.now() + 3600000 },
      { id: 't2', sessionId: 'room-1', roomId: 'room-1', title: '群简报', kind: 'weekly', weekdays: [1, 5], time: '10:00:00', state: 'scheduled', scheduledAt: Date.now() + 7200000 },
    ] }
    return { tasks: [] }
  },
  memoryEndpoint: async (endpoint: string, body: any) => {
    calls.push('memory:' + endpoint + ':' + JSON.stringify(body))
    if (endpoint === 'memory-view') return { entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }], summary: { text: '偏好简洁' }, tidy: { scope: 'own', batch: 'b1', at: Date.now() - 3600000, merged: 2, moved: 1, retired: 0, items: [] } }
    if (endpoint === 'memory-ask') return { reply: '好的，已记录。', changes: [{ op: 'add', text: '喜欢简洁回答', ok: true }], entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }, { id: 'm2', scope: 'own', topic: '偏好', text: '新增条目', pinned: false }], summary: { text: '偏好简洁' } }
    if (endpoint === 'memory-pin') return { entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: body.pin === true }] }
    if (endpoint === 'memory-tidy-undo') return { entries: [{ id: 'm1', scope: 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }], tidy: null }
    if (endpoint === 'memory-layer') return { entries: [{ id: 'm1', scope: body.always === true ? 'team' : 'own', topic: '偏好', text: '喜欢简洁回答', pinned: false }] }
    if (endpoint === 'memory-history') return { rows: [{ id: 'h1', time: Date.now() - 7200000, op: 'add', scope: 'own', text: '喜欢简洁回答', by: 'user', restored: false }, { id: 'h2', time: Date.now() - 10800000, op: 'remove', scope: 'team', text: '旧条目', by: 'Chief', restored: false }], more: body.before === undefined ? 'h2' : null }
    if (endpoint === 'memory-restore') return { entries: [] }
    return { entries: [] }
  },
  computerEnabled: () => true,
  computerView: () => ({ enabled: true, provider: { state: 'ready' }, macos: true, bots: { 'bot-a': { level: 'foreground', apps: { zoom: {}, slack: {} } }, 'bot-b': { level: 'off', apps: {} } } }),
  computerEndpoint: async (endpoint: string, body: any) => { calls.push('computer:' + endpoint + ':' + JSON.stringify(body)); return true },
  usageView: async () => ({
    owners: [
      { key: 'bot-a', kind: 'bot', id: 'bot-a', name: 'Chief' },
      { key: 'bot-b', kind: 'bot', id: 'bot-b', name: 'Dev' },
    ],
    rows: [
      [0, 0, 0, 'chat', 1000, 200, 50, 300, 3],
      [0, 1, 0, 'chat', 500, 100, 20, 100, 1],
      ['2020-01-01 10', 0, 0, 'chat', 9999, 0, 0, 9999, 9],
      [`${new Date().toISOString().slice(0, 10)} 10`, 0, 0, 'chat', 7, 0, 0, 3, 1],
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
  for (const k of keys) {
    stdin.write(k); await wait(400)
    const sel = viewportLines(term, 30).filter((l: string) => l.includes('❯')).map((l: string) => l.trim()).slice(0, 2)
    console.log('step', JSON.stringify(k), '=>', JSON.stringify(sel))
  }
  await wait(500)
  console.log(`=== ${label} ===`)
  for (const l of viewportLines(term, 30).slice(0, 22)) console.log('|' + l + '|')
  console.log('calls:', JSON.stringify(calls))
  await app.unmount(); await wait(100)
}

await run('nav group edit', ['t', 'e', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j'])
