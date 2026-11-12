import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime,
  resetProbeHome,
} from './harness.mjs'

resetProbeHome('memory-edit')

const OLD = '喜欢简洁回答'
const NEW = '喜欢简洁且带例子的回答'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

type Entry = { id: string; scope: string; topic: string; text: string; pinned: boolean }
let viewEntries: Entry[] = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
const calls: { endpoint: string; body: any }[] = []

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }),
  deleteBot: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  memoryEndpoint: async (endpoint: string, body: any) => {
    calls.push({ endpoint, body })
    const view = () => ({ entries: viewEntries.map((entry) => ({ ...entry })), summary: { text: '偏好简洁' }, places: [] })
    if (endpoint === 'memory-view') return view()
    if (endpoint === 'memory-ask') {
      // The add surface is keeper-mediated: it may reword what it stores, so
      // the fake records the line it was asked for rather than echoing the
      // instruction.
      if (String(body.text).includes('更简洁')) {
        viewEntries = [...viewEntries, { id: 'm2', scope: 'own', topic: '偏好', text: NEW, pinned: false }]
      }
      return { reply: '已记下。', changes: [{ op: 'add', ok: true, text: NEW }] }
    }
    if (endpoint === 'memory-forget') {
      viewEntries = viewEntries.filter((entry) => entry.text !== body.text)
      return view()
    }
    throw new Error(`unexpected memory endpoint ${endpoint}`)
  },
}
bindRuntime(() => rt)

async function mount(cols = 120, rows = 34) {
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

async function openMemory(stdin: any) {
  stdin.write('e'); await wait(300)
  for (let at = 0; at < 16; at += 1) { stdin.write('j'); await wait(60) }
  stdin.write('\r'); await wait(500)
}

const writes = () => calls.filter((call) => call.endpoint === 'memory-ask' || call.endpoint === 'memory-forget')

// Enter on an entry opens the inline editor for that entry only.
{
  viewEntries = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  const list = await screen(term, 34)
  expect('the memory panel lists the entry', list.includes('的记忆（') && list.includes(OLD), list.slice(0, 300))

  stdin.write('\r'); await wait(350)
  const edit = await screen(term, 34)
  expect('Enter opens the editor', edit.includes('编辑记忆'), edit.slice(0, 300))
  expect('the editor names its target', edit.includes('目标：Bot 自己的记忆') && edit.includes(`原：${OLD}`), edit.slice(0, 400))
  expect('the editor starts from the current text', edit.includes(OLD))
  await app.unmount(); await wait(120)
}

// Saving replaces the entry: the add goes through memory-ask, then the old
// line is removed by its exact text; the list, summary and change log refresh.
{
  viewEntries = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  stdin.write('\r'); await wait(300)
  stdin.write(' 更简洁'); await wait(250)
  stdin.write('\r'); await wait(900)
  const after = await screen(term, 34)
  const used = writes()
  const ask = used.findIndex((call) => call.endpoint === 'memory-ask')
  const forget = used.findIndex((call) => call.endpoint === 'memory-forget')
  expect('saving adds the new line through memory-ask', ask >= 0, JSON.stringify(used))
  expect('memory-ask targets the same Bot', String(used[ask]?.body?.botId) === 'bot-a', JSON.stringify(used[ask]?.body))
  expect('saving removes the old line', forget > ask && String(used[forget]?.body?.text) === OLD, JSON.stringify(used))
  expect('the removal names the entry scope and topic', used[forget]?.body?.scope === 'own' && used[forget]?.body?.topic === '偏好', JSON.stringify(used[forget]?.body))
  expect('the refreshed list shows the new line', after.includes(NEW), after.slice(0, 500))
  expect('the refreshed list drops the old line', !after.includes(OLD), after.slice(0, 500))
  expect('the change log is refreshed', after.includes('已记下。') || after.includes('add'), after.slice(-400))
  expect('saving returns to the list', !after.includes('编辑记忆') && after.includes('的记忆（'))
  await app.unmount(); await wait(120)
}

// Ctrl+S saves the same way.
{
  viewEntries = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  stdin.write('\r'); await wait(300)
  stdin.write(' 更简洁'); await wait(200)
  stdin.write('\x13'); await wait(900)
  const after = await screen(term, 34)
  expect('Ctrl+S saves the edit', writes().length === 2 && !after.includes('编辑记忆'), JSON.stringify(writes()))
  await app.unmount(); await wait(120)
}

// Esc cancels without writing.
{
  viewEntries = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  stdin.write('\r'); await wait(300)
  stdin.write('不该保存'); await wait(200)
  stdin.write('\u001b'); await wait(400)
  const after = await screen(term, 34)
  expect('Esc cancels without writing', writes().length === 0, JSON.stringify(writes()))
  expect('Esc returns to the memory list', after.includes('的记忆（') && !after.includes('编辑记忆'), after.slice(0, 300))
  expect('the entry is unchanged', after.includes(OLD), after.slice(0, 300))
  await app.unmount(); await wait(120)
}

// Blank content is refused and the editor stays open.
{
  viewEntries = [{ id: 'm1', scope: 'own', topic: '偏好', text: OLD, pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  stdin.write('\r'); await wait(300)
  for (let at = 0; at < 8; at += 1) { stdin.write('\x7f'); await wait(50) }
  stdin.write('\r'); await wait(500)
  const after = await screen(term, 34)
  expect('blank content is refused', writes().length === 0, JSON.stringify(writes()))
  expect('blank content says why', after.includes('记忆内容不能为空'), after.slice(-300))
  expect('the editor stays open', after.includes('编辑记忆'), after.slice(0, 200))
  await app.unmount(); await wait(120)
}

// An entry that names another memory place never reaches the write endpoints.
{
  viewEntries = [{ id: 'm9', scope: 'group', topic: '', text: '别处的记忆', pinned: false }]
  calls.length = 0
  const { term, stdin, app } = await mount()
  await openMemory(stdin)
  stdin.write('\r'); await wait(350)
  const edit = await screen(term, 34)
  expect('the editor shows where the entry belongs', edit.includes('目标：群聊记忆'), edit.slice(0, 400))
  stdin.write(' 改'); await wait(200)
  stdin.write('\r'); await wait(500)
  const after = await screen(term, 34)
  expect('a foreign entry is refused', writes().length === 0, JSON.stringify(writes()))
  expect('the refusal says why', after.includes('只能编辑当前记忆面板里的条目'), after.slice(-300))
  expect('the refusal leaves the list', after.includes('的记忆（') && !after.includes('编辑记忆'), after.slice(0, 300))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`${failures} memory-edit check(s) failed`)
  process.exit(1)
}
console.log('memory-edit checks passed')