import { PassThrough, Writable } from 'node:stream'
import {
  React, ui, render, ThemeProvider, XTerm, viewportLines, TeamScene, bindRuntime, resetProbeHome,
} from './harness.mjs'
import { HELP_SECTIONS, MODE_HINTS, modeHint } from '../../src/scene.js'

resetProbeHome('help')

const BOT_A = 'eeeef6cd-c770-47f7-a467-9173bb5b65f7'

const rt = {
  live: new Map(), load: async () => {}, refresh: async () => {}, readOnly: () => undefined,
  resolveModel: async (m: string) => m, defaultBotModel: () => 'p/a', syncModels: () => {},
  sendUser: async () => {}, createBot: async () => ({ id: 'n' }), deleteBot: async () => {},
  stopChat: async () => true, ensureCapabilities: async () => {},
  catalog: async () => [], cachedCatalog: () => [],
  reasoningOf: async () => ({ efforts: [] }),
  capabilityLibraryView: () => [], capabilityStatusesView: () => ({}),
  approvalsView: () => [],
  computerEnabled: () => true,
  computerView: () => ({ enabled: true, provider: { state: 'ready' }, macos: false, bots: {}, apps: [] }),
  usageView: async () => ({ owners: [], rows: [] }),
}
bindRuntime(() => rt)

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

async function mount(cols: number, rows: number) {
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

// The roster advertises the key, `?` opens the grouped help, and the overlay
// scrolls with the arrow keys.
{
  const { term, stdin, app } = await mount(120, 40)
  const list = await screen(term, 40)
  expect('roster advertises the help key', list.includes('? 帮助'), list.slice(0, 160))

  stdin.write('?'); await wait(400)
  let help = await screen(term, 40)
  expect('? opens the help overlay', help.includes('按键帮助'), help.slice(0, 160))
  expect('help lists the roster section', help.includes('── 名册'))
  expect('help lists the settings section', help.includes('── Bot 设置'))
  expect('help lists the group section', help.includes('── 群聊'))
  expect('help has a footer hint', help.includes('↑↓ 滚动 · Esc 返回'))
  expect('help is scrollable at this height', !help.includes('── 用量'), help.slice(-240))

  for (let at = 0; at < 50; at += 1) {
    stdin.write('\u001b[B')
    await wait(12)
  }
  await wait(300)
  const scrolled = await screen(term, 40)
  expect('down arrow scrolls the help', scrolled !== help && scrolled.includes('── 用量'), scrolled.slice(-240))

  stdin.write('\u001b'); await wait(400)
  const back = await screen(term, 40)
  expect('Esc leaves the help', !back.includes('按键帮助') && back.includes('DS Bot'), back.slice(0, 160))

  // A rendered panel carries exactly the hint from MODE_HINTS.
  const panels: Array<[string, string, number]> = [
    ['e', MODE_HINTS.edit, 400],
    ['t', MODE_HINTS.groups, 400],
    ['a', MODE_HINTS.approvals, 500],
    ['Y', MODE_HINTS.usage, 900],
    ['o', MODE_HINTS.computer, 500],
  ]
  for (const [key, hint, pause] of panels) {
    stdin.write(key); await wait(pause)
    const panel = await screen(term, 40)
    expect(`${key} panel shows its hint`, panel.includes(hint), panel.slice(-200))
    stdin.write('\u001b'); await wait(350)
  }

  await app.unmount(); await wait(120)
}

// Every help entry fits in a tall terminal, so the overlay can be checked in
// full: section titles, key tokens and descriptions.
{
  const { term, stdin, app } = await mount(120, 200)
  stdin.write('?'); await wait(450)
  const help = await screen(term, 200)
  for (const section of HELP_SECTIONS) {
    expect(`help shows ${section.title}`, help.includes(`── ${section.title}`))
    for (const [key, description] of section.keys) {
      expect(`help shows key ${key}`, help.includes(key), key)
      expect(`help explains ${key}`, help.includes(description), description)
    }
  }
  stdin.write('?'); await wait(400)
  const closed = await screen(term, 200)
  expect('? closes the help again', !closed.includes('按键帮助') && closed.includes('DS Bot'), closed.slice(0, 160))
  await app.unmount(); await wait(120)
}

// Every mode has a one-line hint, and the two state-dependent modes vary.
for (const mode of Object.keys(MODE_HINTS)) {
  const hint = modeHint(mode, { fieldKey: 'instructions', scheduleStep: 4 })
  expect(`mode ${mode} has a hint`, typeof hint === 'string' && hint.length > 0 && !hint.includes('\n'), String(hint))
}
expect('field hint follows the editor', modeHint('field', { fieldKey: 'instructions' }).includes('Ctrl+Enter'))
expect('schedule hint follows the step', modeHint('schedule-new', { scheduleStep: 4 }).includes('1–7'))

if (failures > 0) {
  console.log(`${failures} help check(s) failed`)
  process.exit(1)
}
console.log('help checks passed')