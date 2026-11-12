import { apply } from '../../src/controller.js'

let failures = 0
function expect(label: string, ok: boolean, detail = '') {
  if (ok) console.log(`PASS ${label}`)
  else {
    failures += 1
    console.log(`FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const event = (seq: number, type: string, extra: Record<string, unknown> = {}) => ({
  seq, type, time: 1000 + seq, data: {}, surfaceOp: 'append', ...extra,
})

// A contiguous log in seq order, the shape `SessionHandle.read` returns.
const LOG = [
  event(0, 'turn/start'),
  event(1, 'user/message'),
  event(2, 'assistant/message'),
  event(3, 'tool/call'),
  event(4, 'tool/result'),
  event(5, 'turn/end'),
  event(6, 'user/message'),
  event(7, 'assistant/message'),
  event(8, 'turn/end'),
  event(9, 'user/message'),
]

function harness(log: readonly unknown[], options: { missing?: boolean; failRead?: boolean } = {}) {
  const calls: string[] = []
  const persistence = {
    async open(id: string, access: string) {
      calls.push(`open:${id}:${access}`)
      if (options.missing) {
        const error = new Error(`session "${id}" is not available`)
        error.sessionId = id
        throw error
      }
      return {
        id,
        access,
        async read(offset = 0, length?: number) {
          calls.push(`read:${offset}:${length}`)
          if (options.failRead) throw new Error('corrupt log')
          return { eventState: 'detached', events: log.slice(offset, length === undefined ? undefined : offset + length) }
        },
        async close() { calls.push(`close:${id}`) },
        async append() { calls.push(`append:${id}`); throw new Error('read-only') },
        async flush() { calls.push(`flush:${id}`) },
      }
    },
  }
  const provided: Record<string, unknown> = {}
  const ctx = {
    get: (name: string) => (name === 'sessionPersistence' ? persistence : undefined),
    provide: (name: string, value: unknown) => { provided[name] = value },
    agents: { get: () => undefined, resume: async () => { throw new Error('no agent') } },
    llm: {},
    workspaceRegistry: {},
  }
  apply(ctx)
  return { controller: (provided.sessionController as any), calls }
}

const controller = harness(LOG).controller
const page = (request: Record<string, unknown>) => controller.page({
  address: { kind: 'session', sessionId: 's1' },
  ...request,
})

// Normal page: newest messages first in the request, chronological in the
// response, with the boundary events that share their turn.
{
  const result = await page({ throughSeq: 9, maxMessages: 2 })
  expect('page returns the newest messages', result.records.map((r: any) => r.event.seq).join(',') === '7,8,9', JSON.stringify(result.records.map((r: any) => r.event.seq)))
  expect('records keep the DSH wire shape', result.records.every((r: any) => r.type === 'event' && r.event.seq !== undefined))
  expect('page reports more history', result.hasMore === true)
  expect('page reports the resolved cursor', result.cursor === 9, String(result.cursor))
}

// A larger budget reaches the start of the log and clears hasMore.
{
  const result = await page({ throughSeq: 9, maxMessages: 50 })
  expect('whole log fits one page', result.records.length === LOG.length && result.hasMore === false, `${result.records.length}/${LOG.length}`)
  expect('whole log stays in order', result.records.every((r: any, at: number) => r.event.seq === at))
}

// beforeSeq is exclusive: the page stops below it.
{
  const result = await page({ throughSeq: 9, beforeSeq: 6, maxMessages: 2 })
  expect('beforeSeq cuts the page', result.records.map((r: any) => r.event.seq).join(',') === '1,2,3,4,5', JSON.stringify(result.records.map((r: any) => r.event.seq)))
  expect('beforeSeq page has more', result.hasMore === true)
}

// Only append-origin messages spend the budget; a replacement copy does not.
{
  const log = [
    event(0, 'user/message'),
    event(1, 'assistant/message', { surfaceOp: 'replace' }),
    event(2, 'assistant/message'),
  ]
  const result = await harness(log).controller.page({ address: { kind: 'session', sessionId: 's1' }, throughSeq: 2, maxMessages: 1 })
  expect('replacement copies do not consume the budget', result.records.map((r: any) => r.event.seq).join(',') === '2', JSON.stringify(result.records.map((r: any) => r.event.seq)))
}

// A message with sourceEventSeqs keeps its whole group on the page.
{
  const log = [
    event(0, 'turn/start'),
    event(1, 'user/message'),
    event(2, 'assistant/message'),
    event(3, 'tool/call'),
    event(4, 'tool/result'),
    event(5, 'assistant/message', { sourceEventSeqs: [3, 4] }),
  ]
  const result = await harness(log).controller.page({ address: { kind: 'session', sessionId: 's1' }, throughSeq: 5, maxMessages: 1 })
  expect('a message group stays together', result.records.map((r: any) => r.event.seq).join(',') === '3,4,5', JSON.stringify(result.records.map((r: any) => r.event.seq)))
}

// Missing, empty and out-of-range reads are empty pages, never throws.
{
  const missing = await harness(LOG, { missing: true }).controller.page({ address: { kind: 'session', sessionId: 'nope' }, throughSeq: 9 })
  expect('unknown session is an empty page', missing.records.length === 0 && missing.hasMore === false)

  const empty = await harness([]).controller.page({ address: { kind: 'session', sessionId: 's1' }, throughSeq: 0 })
  expect('a session without records is an empty page', empty.records.length === 0 && empty.hasMore === false)

  const beforeStart = await page({ throughSeq: -1, maxMessages: 5 })
  expect('throughSeq -1 is an empty page', beforeStart.records.length === 0 && beforeStart.hasMore === false)
}

// The page reads through the persistence seam only, and always closes.
{
  const { controller: fresh, calls } = harness(LOG)
  const result = await fresh.page({ address: { kind: 'session', sessionId: 's1' }, throughSeq: 9, maxMessages: 2 })
  expect('page opens a read handle', calls.includes('open:s1:read'))
  expect('page reads the stored log', calls.some((call) => call.startsWith('read:')))
  expect('page closes the handle', calls.filter((call) => call === 'close:s1').length === 1)
  expect('page never writes', !calls.some((call) => call.startsWith('append:') || call.startsWith('flush:')))
  expect('page still returns records', result.records.length === 3)
}

// A subagent address reads the child's own stored log.
{
  const { controller: fresh, calls } = harness(LOG)
  await fresh.page({ address: { kind: 'subagent', parentSessionId: 'p', childSessionId: 'child-1', mode: 'unknown' }, throughSeq: 9, maxMessages: 1 })
  expect('subagent pages the child session', calls.includes('open:child-1:read'))
}

// A read failure still releases the handle.
{
  const { controller: fresh, calls } = harness(LOG, { failRead: true })
  let threw = false
  try {
    await fresh.page({ address: { kind: 'session', sessionId: 's1' }, throughSeq: 9 })
  } catch {
    threw = true
  }
  expect('read failures surface', threw)
  expect('read failures close the handle', calls.includes('close:s1'))
}

if (failures > 0) {
  console.log(`${failures} paging check(s) failed`)
  process.exit(1)
}
console.log('paging checks passed')