// Live Bot activity and read state for the roster.
//
// The roster could stay a pure state.json reader, but then every Bot looks the
// same: working, idle and waiting-for-an-answer are indistinguishable, and a
// reply that arrived while the user was elsewhere goes unnoticed. So the plugin
// listens to the session stream it already has in-process and folds the few
// events that matter into a per-session record; the roster renders that record.
//
// Read state is stored outside DS Bot's home: it is a terminal-local preference
// (`$DSH_TUI_HOME` or ~/.dsh-tui), not part of the team.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const LAST_TEXT_MAX = 160
const LAST_MESSAGES = 5
const FAILURE_TEXT_MAX = 120

const activity = new Map()
const seen = new Map()
const listeners = new Set()
let seenPath
let writeTimer

function homeDir() {
  return process.env.DSH_TUI_HOME || join(homedir(), '.dsh-tui')
}

function loadSeen() {
  seenPath = join(homeDir(), 'dsh-bot-tui-seen.json')
  try {
    const parsed = JSON.parse(readFileSync(seenPath, 'utf8'))
    for (const [id, at] of Object.entries(parsed.seen ?? {})) {
      if (typeof at === 'number') seen.set(id, at)
    }
  } catch {
    // Missing or unreadable: start with nothing read; it only costs one badge.
  }
}

function saveSeen() {
  clearTimeout(writeTimer)
  writeTimer = setTimeout(() => {
    try {
      mkdirSync(dirname(seenPath), { recursive: true })
      writeFileSync(seenPath, JSON.stringify({ seen: Object.fromEntries(seen) }))
    } catch {
      // A read marker that cannot be written is not worth failing a turn over.
    }
  }, 300)
}

function textOf(message) {
  const blocks = Array.isArray(message?.content) ? message.content : []
  return blocks
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function touch() {
  for (const listener of listeners) listener()
}

function remember(record, role, text, at) {
  const clean = text.length > LAST_TEXT_MAX ? `${text.slice(0, LAST_TEXT_MAX)}…` : text
  const messages = Array.isArray(record.messages) ? record.messages : []
  messages.push({ role, text: clean, at })
  while (messages.length > LAST_MESSAGES) messages.shift()
  record.messages = messages
  record.lastText = clean
  record.lastRole = role
  record.lastAt = Math.max(record.lastAt, at)
}

// The agent loop writes the only durable failure record: `turn/end` with
// `reason.kind === 'error'` and `{ message, code }` from the thrown error (or
// `LlmError.failure`). Anything else (aborted, completed, blocked) is not a
// failure; a later non-error turn end clears the last one.
function failureText(reason) {
  const error = reason?.error
  const text = typeof error?.message === 'string' && error.message.trim() !== ''
    ? error.message.trim()
    : typeof error?.code === 'string' && error.code !== ''
    ? error.code
    : undefined
  if (text === undefined) return undefined
  return text.length > FAILURE_TEXT_MAX ? `${text.slice(0, FAILURE_TEXT_MAX)}…` : text
}

/** Fold one session event into the live record. */
export function observe(session, event) {
  const sessionId = String(session?.id ?? event?.sessionId ?? '')
  if (sessionId === '') return
  const type = String(event?.type ?? '')
  const at = Number(event?.time ?? Date.now())
  const record = activity.get(sessionId) ?? {
    status: 'idle',
    since: at,
    lastAt: 0,
    lastText: '',
    lastRole: '',
    messages: [],
  }

  switch (type) {
    case 'turn/start':
      record.status = 'working'
      record.since = at
      break
    case 'turn/end': {
      const reason = event?.data?.reason
      if (reason?.kind === 'error') {
        record.failure = { at, reason: failureText(reason), source: type }
      } else if (reason?.kind !== 'aborted') {
        // A completed (or blocked/max-tokens) turn means the session works
        // again; an abort is the user stopping, not proof of recovery.
        record.failure = undefined
      }
      record.status = 'idle'
      record.since = at
      break
    }
    case 'step/start':
      if (record.status === 'idle') record.status = 'working'
      break
    case 'approval/asked':
      record.status = 'needs-input'
      break
    case 'approval/decided':
      record.status = 'working'
      break
    case 'assistant/message': {
      const text = textOf(event?.data?.message)
      if (text !== '') remember(record, 'assistant', text, at)
      break
    }
    case 'user/message': {
      const text = textOf({ content: event?.data?.content })
      if (text !== '') remember(record, 'user', text, at)
      break
    }
    default:
      break
  }
  activity.set(sessionId, record)
  touch()
}

/** Current live record for a Session, or undefined when it never ran here. */
export function activityOf(sessionId) {
  return sessionId === undefined || sessionId === null ? undefined : activity.get(String(sessionId))
}

/** Drop one session's failure marker; false when there was none. */
export function clearFailure(sessionId) {
  const record = activityOf(sessionId)
  if (record?.failure === undefined) return false
  record.failure = undefined
  touch()
  return true
}

/** True when a Bot replied after the user last opened that Session. */
export function unreadOf(sessionId) {
  const record = activityOf(sessionId)
  if (record === undefined || record.lastAt === 0) return 0
  const readAt = seen.get(String(sessionId)) ?? 0
  return record.lastRole === 'assistant' && record.lastAt > readAt ? 1 : 0
}

export function markSeen(sessionId) {
  if (sessionId === undefined || sessionId === null) return
  const record = activityOf(sessionId)
  seen.set(String(sessionId), Math.max(Date.now(), record?.lastAt ?? 0))
  saveSeen()
  touch()
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function install(ctx) {
  loadSeen()
  ctx.on('session/event', observe)
}
