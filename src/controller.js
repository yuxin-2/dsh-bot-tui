// `sessionController` is the web profile's session RPC surface. The DS Bot host
// plugin injects it for four calls — create / prompt / resolveAgent / page —
// and dsh-TUI composes no web API layer, so the service is absent there.
//
// This row provides the same four methods on the process-local Agent registry
// (`ctx.agents`) plus the durable Session log (`ctx.sessionPersistence`), which
// dsh-TUI itself uses for resume and new sessions. It is a compatibility
// surface, not an RPC endpoint: no HTTP, no typert lookups, no file receipts.
// The parts DS Bot needs for a Bot turn are the agent, the prompt, and the
// agent's own Session; history pages read the stored log without writing it.
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'bot-session-controller'

export const inject = ['agents', 'llm', 'workspaceRegistry']

const notFound = (sessionId, error) => ({
  code: 'session/not-found',
  message: error?.message ?? `session "${sessionId}" is not available`,
})

// The two message kinds that consume a page's budget. DSH's own history page
// counts only these (plus append-origin surface copies); boundary and tool
// events ride along in the returned slice without spending a slot.
const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/**
 * Cut one backwards page from a contiguous, seq-ascending event log.
 *
 * Mirrors DSH's history pagination: the page ends at `throughSeq` (inclusive)
 * or just below `beforeSeq`, walks backwards counting message events, and when
 * the budget is spent cuts at the earliest seq of that message's group so a
 * message and the events it was derived from stay together. Records stay in
 * chronological order, exactly as DSH returns them.
 */
function pageOf(events, request) {
  const maxMessages = Number.isSafeInteger(request.maxMessages) && request.maxMessages > 0
    ? request.maxMessages
    : 50
  if (events.length === 0) {
    return { records: [], hasMore: false, cursor: Number.isSafeInteger(request.throughSeq) ? request.throughSeq : -1 }
  }
  const firstSeq = events[0].seq
  const lastSeq = events[events.length - 1].seq
  const through = Number.isSafeInteger(request.throughSeq) ? request.throughSeq : lastSeq
  const end = Math.min(through + 1, request.beforeSeq ?? through + 1)
  if (end <= firstSeq) return { records: [], hasMore: false, cursor: through }

  const indexOf = new Map()
  for (let at = 0; at < events.length; at += 1) indexOf.set(events[at].seq, at)
  let endIndex = events.length
  while (endIndex > 0 && events[endIndex - 1].seq >= end) endIndex -= 1

  let cut = 0
  let count = 0
  for (let at = endIndex - 1; at >= 0; at -= 1) {
    const event = events[at]
    // A replacement copy shadows an older surface range; the transcript's
    // durable source is the append-origin event, so only those are budgeted.
    if (!MESSAGE_TYPES.has(event.type) || event.surfaceOp !== 'append') continue
    count += 1
    if (count >= maxMessages) {
      let groupStart = event.seq
      const sources = event.sourceEventSeqs
      if (Array.isArray(sources)) {
        for (const source of sources) if (source < groupStart) groupStart = source
      }
      cut = indexOf.get(groupStart) ?? at
      break
    }
  }
  return {
    records: events.slice(cut, endIndex).map((event) => ({ type: 'event', event })),
    hasMore: cut > 0,
    cursor: through,
  }
}

export function apply(ctx) {
  // One resume at a time per session: DS Bot can ask twice while a delivery is
  // racing a user prompt, and two concurrent resumes would build two agents.
  const resuming = new Map()

  const live = (sessionId) => ctx.agents.get(String(sessionId))

  const resolve = async (sessionId) => {
    const id = String(sessionId)
    const found = live(id)
    if (found !== undefined) return { agent: found }
    const pending = resuming.get(id)
    if (pending !== undefined) return pending
    const running = (async () => {
      try {
        const handle = await ctx.agents.resume({ resumeSessionId: id })
        return { agent: handle.agent }
      } catch (error) {
        return { error: notFound(id, error) }
      } finally {
        resuming.delete(id)
      }
    })()
    resuming.set(id, running)
    return running
  }

  const controller = {
    /** Resolve a live agent, else load its persisted Session. */
    resolveAgent: resolve,

    /**
     * Create one ordinary Session. DS Bot uses this for a Bot's own chat and for
     * each group Session; the agent loop's factory owns the session header, so
     * this returns the identity the registry minted.
     */
    async create(request = {}) {
      const sessionId = request.sessionId ?? randomUUID()
      // DS Bot asks for the team Workspace by id, not by path: the Session must
      // start where the team folder is, not wherever the terminal happened to be.
      const workspace = request.workspaceId === undefined
        ? undefined
        : ctx.workspaceRegistry.get(request.workspaceId)
      const cwd = request.cwd ?? workspace?.path ?? process.cwd()
      const meta = { cwd, ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }) }
      const handle = await ctx.agents.create({ sessionId, meta })
      return {
        sessionId: handle.agent.id,
        ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
      }
    },

    /**
     * Record the Session's model selection. DS Bot calls this when a Bot's
     * model is applied (and whenever the user changes it): without it the
     * agent has a provider name in state.json but no route to call.
     */
    async selectModel(request) {
      const found = await resolve(request.sessionId)
      if (found.error !== undefined) {
        throw Object.assign(new Error(found.error.message), { code: found.error.code })
      }
      const selected = {
        provider: request.provider,
        model: request.model,
        ...(request.reasoningEffort === undefined ? {} : { reasoningEffort: request.reasoningEffort }),
      }
      if (typeof ctx.llm?.resolveCallConfig === 'function') await ctx.llm.resolveCallConfig(selected)
      found.agent.model.select(selected)
      return { selected: { ...selected } }
    },

    /**
     * Queue (or steer) one user message. Mirrors the web controller's accepted
     * shape: the Session's agent takes the message, the turn runs on its loop.
     */
    async prompt(request, signal) {
      if (signal?.aborted) throw new Error('prompt aborted')
      const found = await resolve(request.sessionId)
      if (found.error !== undefined) {
        throw Object.assign(new Error(found.error.message), { code: found.error.code })
      }
      const message = createUserMessage({
        content: request.content ?? [],
        source: { kind: 'user' },
      })
      if (request.mode === 'steer') found.agent.steer(message)
      else found.agent.followup(message)
      return { accepted: true }
    },

    /**
     * History pages for handoffs, usage and memory. Reads the stored Session log
     * through the public persistence seam only: open a `read` handle, take one
     * contiguous slice, close it. Nothing is appended, flushed or rewritten, so
     * a page can never race or alter the live Session's own writes.
     *
     * DS Bot pages backwards: `throughSeq` is the inclusive log cut, then each
     * older page passes `beforeSeq` (exclusive) and the newest seq it saw. A
     * missing or empty Session is an empty page, not an error — a handoff note
     * degrades instead of failing the turn.
     */
    async page(request = {}, signal) {
      const empty = { records: [], hasMore: false }
      if (signal?.aborted) return empty
      const address = request.address
      const sessionId = address?.kind === 'subagent' ? address.childSessionId : address?.sessionId
      if (sessionId === undefined || sessionId === null || String(sessionId) === '') return empty
      const persistence = ctx.get?.('sessionPersistence')
      if (persistence === undefined || typeof persistence.open !== 'function') return empty

      let handle
      try {
        handle = await persistence.open(String(sessionId), 'read', { signal })
      } catch {
        // No durable log for this id (or it was removed while we looked): the
        // caller asked for history, and there is none to give.
        return empty
      }
      try {
        const { events } = await handle.read(0, undefined, { signal })
        return pageOf(Array.isArray(events) ? events : [], request)
      } finally {
        await handle.close()
      }
    },
  }

  ctx.provide('sessionController', controller)
}
