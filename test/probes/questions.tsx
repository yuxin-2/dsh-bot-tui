import { PassThrough, Writable } from 'node:stream'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'
import { answerFor, questionsForBots, readQuestions } from '../../src/questions.js'

const ROOT = resetProbeHome('questions')
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

const bot = (id: string, name: string, sessionId: string) => ({
  id, name, role: name, model: 'p/a', sessionId, segments: [], capabilities: [],
})

const QUESTIONS = {
  'sess-a': {
    id: 'q-a', question: '先做哪一块？', detail: '会影响今晚的排期',
    options: [{ label: '登录' }, { label: '支付', description: '风险高' }], askedAt: 1000,
  },
  'sess-b': {
    id: 'q-b', question: '要通知哪些人？',
    options: [{ label: '设计' }, { label: '运营' }, { label: '客服' }],
    multiSelect: true, allowCustom: true, askedAt: 2000,
  },
}

function state(questions: any = QUESTIONS) {
  writeFileSync(STATE, JSON.stringify({
    mainBotIds: ['bot-a'],
    revision: 1,
    bots: {
      'bot-a': bot('bot-a', 'Chief', 'sess-a'),
      'bot-b': bot('bot-b', 'Dev', 'sess-b'),
      'bot-c': bot('bot-c', 'Ops', 'sess-c'),
    },
    sections: [],
    capabilities: { items: {} },
    questions,
  }))
}

const calls: any[] = []
const closed: any[] = []
const rt: any = {
  live: new Map(), load: async () => { rt.state = JSON.parse(readFileSync(STATE, 'utf8')) },
  refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, stopChat: async () => true, ensureCapabilities: async () => {},
  answerQuestion: async (sessionId: string, questionId: string, answer: any) => {
    calls.push({ sessionId, questionId, answer })
    const next = JSON.parse(readFileSync(STATE, 'utf8'))
    if (next.questions !== undefined) delete next.questions[sessionId]
    writeFileSync(STATE, JSON.stringify(next))
  },
  closeCard: (sessionId: string, card: any, outcome: string) => closed.push({ sessionId, card, outcome }),
  save: async () => { writeFileSync(STATE, JSON.stringify(rt.state)) },
  state: { questions: {} },
}
bindRuntime(() => rt)

// Pure: normalise the cards, match them to rows, and build DS Bot's answer shape.
{
  const parsed = readQuestions({
    questions: {
      s1: { id: 'q1', question: ' 选一个 ', options: ['A', { label: ' B ', description: ' 说明 ' }], askedAt: 5 },
      s2: { id: 'q2', question: '', options: ['A'] },
      s3: { id: 'q3', question: '没有选项', options: [] },
      s4: { id: '', question: '缺 id', options: ['A'] },
      s5: { id: 'q5', question: '后来', options: ['A'], askedAt: 9 },
      s6: { id: 'q6', question: '最早', options: ['A'], askedAt: 1 },
    },
  })
  expect('questions are trimmed, validated and sorted by asked time', parsed.map((card: any) => card.sessionId).join(',') === 's6,s1,s5', JSON.stringify(parsed))
  expect('option strings and objects normalise', parsed[1].options[1].label === 'B' && parsed[1].options[1].description === '说明', JSON.stringify(parsed[1]))
  expect('a question without options is not answerable', parsed.every((card: any) => card.id !== 'q3'), JSON.stringify(parsed))

  const bots = [
    { id: 'b1', sessionId: 's1', segments: [] },
    { id: 'b2', sessionId: 'sX', segments: ['s1'] },
  ]
  const matched = questionsForBots(bots, parsed)
  expect('cards match current Session and earlier segments', matched.byBot.get('b1')?.id === 'q1' && matched.byBot.get('b2')?.id === 'q1', JSON.stringify([...matched.byBot]))
  expect('unowned cards stay visible as orphans', matched.orphans.some((card: any) => card.sessionId === 's6'), JSON.stringify(matched.orphans))

  const single = { options: [{ label: 'A' }, { label: 'B' }], multiSelect: false, allowCustom: false }
  expect('single choice keeps one offered label', JSON.stringify(answerFor(single, ['B', 'A'])) === JSON.stringify({ selected: ['B'] }), JSON.stringify(answerFor(single, ['B', 'A'])))
  expect('an unknown label is refused', answerFor(single, ['C']) === undefined)
  expect('multi choice dedupes labels', JSON.stringify(answerFor({ ...single, multiSelect: true }, ['A', 'A', 'B'])) === JSON.stringify({ selected: ['A', 'B'] }))
  expect('custom text needs card permission', answerFor(single, [], '自己写') === undefined)
  expect('allowed custom text is trimmed and sent', JSON.stringify(answerFor({ ...single, allowCustom: true }, [], '  自己写  ')) === JSON.stringify({ selected: [], custom: '自己写' }))
}

async function mount(cols = 120, rows = 34) {
  const term = new XTerm({ cols, rows, scrollback: 0, allowProposedApi: true })
  class FakeStdout extends Writable { columns = cols; rows = rows; isTTY = true; _write(c: any, _e: any, cb: any) { term.write(String(c), cb) } }
  class FakeStdin extends PassThrough { isTTY = true; setRawMode() { return this } ref() { return this } unref() { return this } }
  const stdin = new FakeStdin()
  const channel = { sessionId: 'sess-c', provider: 'p', model: 'a', resumeTo: async () => ({ ok: true }), submit: () => {}, stopBackgroundAgent: async () => true }
  const app = await render(
    React.createElement(ThemeProvider, { theme: 'dark' },
      React.createElement(TeamScene, { React, ui, channel, close: () => {} })),
    { stdout: new FakeStdout(), stdin, exitOnCtrlC: false, patchConsole: false })
  await wait(450)
  return { term, stdin, app }
}
const screen = (term: any, rows: number) => viewportLines(term, rows).join('\n')
const focused = (term: any, rows: number) => screen(term, rows).split('\n').filter((line) => line.includes('❯')).join(' | ')

// The roster has to show that a Bot waits on a card even though its turn ended.
{
  state()
  const { term, stdin, app } = await mount()
  const view = await screen(term, 34)
  expect('a question shows as an attention state', view.includes('待答问题'), view.slice(0, 900))
  expect('the header counts open questions', view.includes('待答 2'), view.slice(0, 400))
  expect('the footer counts open questions', view.includes('还有 2 个待答问题'), view.slice(-500))
  expect('the detail panel names the question', view.includes('先做哪一块？') && view.includes('Q 回答'), view.slice(0, 1200))

  stdin.write('g'); await wait(300)
  expect('g jumps to a Bot with an open question', focused(term, 34).includes('Dev'), focused(term, 34))
  await app.unmount(); await wait(120)
}

// Q opens the card; Enter answers the highlighted single choice and the next
// card takes its place.
{
  state()
  calls.length = 0
  const { term, stdin, app } = await mount()
  stdin.write('Q'); await wait(350)
  let view = await screen(term, 34)
  expect('Q opens the question panel', view.includes('待答问题（1/2）') && view.includes('先做哪一块？'), view.slice(0, 1200))
  expect('options carry their descriptions', view.includes('1. ○ 登录') && view.includes('2. ○ 支付') && view.includes('风险高'), view.slice(0, 1200))

  stdin.write('\r'); await wait(500)
  expect('Enter answers the highlighted option', calls.length === 1 && calls[0].sessionId === 'sess-a'
    && calls[0].questionId === 'q-a' && calls[0].answer.selected.join(',') === '登录', JSON.stringify(calls))
  view = await screen(term, 34)
  expect('the panel moves to the next question', view.includes('要通知哪些人？') && view.includes('待答问题（1/1）'), view.slice(0, 1200))
  expect('the answered card is gone from state', JSON.parse(readFileSync(STATE, 'utf8')).questions['sess-a'] === undefined)

  stdin.write(' '); await wait(200)
  stdin.write('j'); await wait(150)
  stdin.write(' '); await wait(200)
  stdin.write('\r'); await wait(500)
  expect('multi-select sends every toggled label', calls.length === 2
    && calls[1].answer.selected.join(',') === '设计,运营', JSON.stringify(calls[1]))
  view = await screen(term, 34)
  expect('answering the last card returns to the roster', !view.includes('待答问题（') && view.includes('已回复 Dev。'), view.slice(-500))
  expect('the roster no longer counts questions', !view.includes('待答问题') && !view.includes('待答 2'), view.slice(0, 600))
  await app.unmount(); await wait(120)
}

// A card that allows free text: c opens a line, Enter sends it with no labels.
{
  state({
    'sess-b': { id: 'q-b', question: '还有什么要补充？', options: [{ label: '没有' }], allowCustom: true, askedAt: 1 },
  })
  calls.length = 0
  const { term, stdin, app } = await mount()
  stdin.write('Q'); await wait(350)
  stdin.write('c'); await wait(200)
  let view = await screen(term, 34)
  expect('c opens the custom answer line', view.includes('自定义回答'), view.slice(-600))

  stdin.write('下周再定'); await wait(250)
  stdin.write('\r'); await wait(500)
  expect('custom text is sent as the answer', calls.length === 1
    && calls[0].answer.selected.length === 0 && calls[0].answer.custom === '下周再定', JSON.stringify(calls))
  await app.unmount(); await wait(120)
}

// Closing a card is not answering it: closeCard gets the card, state drops it.
{
  state({
    'sess-a': { id: 'q-a', question: '要关掉吗？', options: [{ label: '是' }], askedAt: 1 },
  })
  closed.length = 0
  const { term, stdin, app } = await mount()
  stdin.write('Q'); await wait(350)
  stdin.write('x'); await wait(500)
  expect('x closes the card through the runtime', closed.length === 1 && closed[0].sessionId === 'sess-a' && closed[0].outcome === 'dismissed', JSON.stringify(closed))
  expect('closing removes the card from state', JSON.parse(readFileSync(STATE, 'utf8')).questions['sess-a'] === undefined)
  const view = await screen(term, 34)
  expect('closing says the card was not answered', view.includes('已关闭提问卡片（未回答）'), view.slice(-500))
  await app.unmount(); await wait(120)
}

// No cards: Q only says so and the roster keeps no attention line.
{
  state({})
  const { term, stdin, app } = await mount()
  stdin.write('Q'); await wait(350)
  const view = await screen(term, 34)
  expect('Q with no questions says so', view.includes('没有待答问题。'), view.slice(-500))
  expect('no question chip or footer line without cards', !view.includes('待答 1') && !view.includes('? 待答：'), view.slice(0, 800))
  await app.unmount(); await wait(120)
}

if (failures > 0) {
  console.log(`\n${failures} expectation(s) failed`)
  process.exit(1)
}
