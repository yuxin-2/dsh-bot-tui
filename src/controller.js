// `sessionController` is the web profile's session RPC surface. The DS Bot host
// plugin injects it for four calls — create / prompt / resolveAgent / page —
// and dsh-TUI composes no web API layer, so the service is absent there.
//
// This row provides the same four methods on the process-local Agent registry
// (`ctx.agents`), which dsh-TUI itself uses for resume and new sessions. It is
// a compatibility surface, not an RPC endpoint: no HTTP, no typert lookups, no
// file receipts. The parts DS Bot needs for a Bot turn are the agent, the
// prompt, and the agent's own Session.
import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

export const name = 'bot-session-controller'

export const inject = ['agents', 'llm', 'workspaceRegistry']

const notFound = (sessionId, error) => ({
  code: 'session/not-found',
  message: error?.message ?? `session "${sessionId}" is not available`,
})

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
     * History pages for handoffs and memory. DS Bot reads backwards through a
     * Session here; a terminal-first pass keeps the live Session's own record
     * when it exists and reports an empty page otherwise, so a missing read
     * degrades a handoff instead of breaking a turn.
     */
    async page() {
      return { records: [], hasMore: false }
    },
  }

  ctx.provide('sessionController', controller)
}
