// `ask_user` question cards live in DS Bot's state, not in the DSH session log:
// the browser draws them from state.json and answers through `answer-question`.
// dsh-TUI has no such renderer, so without this module a Bot can ask a question,
// end its turn, and look idle while the card waits forever.
//
// This module is the pure half: normalise the cards, match them to roster rows,
// and build the answer shape DS Bot accepts. The scene owns the panel and the
// runtime call.
const MAX_OPTIONS = 6
const MAX_QUESTION = 2000
const MAX_CUSTOM = 2000

const textOf = (value) => (typeof value === 'string' ? value.trim() : '')

/** The open question cards in a parsed state.json, oldest ask first. */
export function readQuestions(state) {
  const cards = []
  for (const [sessionId, card] of Object.entries(state?.questions ?? {})) {
    if (typeof sessionId !== 'string' || sessionId === '') continue
    if (card === null || typeof card !== 'object' || Array.isArray(card)) continue
    const id = textOf(card.id)
    const question = textOf(card.question)
    if (id === '' || question === '') continue
    const options = (Array.isArray(card.options) ? card.options : [])
      .map((option) => {
        if (typeof option === 'string') return { label: textOf(option), description: '' }
        return {
          label: textOf(option?.label),
          description: textOf(option?.description),
        }
      })
      .filter((option) => option.label !== '')
      .slice(0, MAX_OPTIONS)
    // DS Bot refuses a card without options, so an empty one is not a card the
    // terminal could answer; leaving it out keeps the panel honest.
    if (options.length === 0) continue
    cards.push({
      sessionId,
      id,
      question: question.slice(0, MAX_QUESTION),
      detail: textOf(card.detail),
      options,
      multiSelect: card.multiSelect === true,
      allowCustom: card.allowCustom === true,
      askedAt: Number.isFinite(card.askedAt) ? Number(card.askedAt) : 0,
    })
  }
  return cards.sort((a, b) => a.askedAt - b.askedAt || a.sessionId.localeCompare(b.sessionId))
}

/**
 * Match cards to roster rows by current Session, Bot id, then earlier segment.
 * Returns the per-Bot cards plus the ones no current row owns (a stale card from
 * a rotated part still deserves a visible row and a close button).
 */
export function questionsForBots(bots, cards) {
  const bySession = new Map(cards.map((card) => [card.sessionId, card]))
  const byBot = new Map()
  const owned = new Set()
  for (const bot of bots) {
    const card = bySession.get(bot.sessionId)
      ?? bySession.get(bot.id)
      ?? (Array.isArray(bot.segments) ? bot.segments.map((id) => bySession.get(String(id))).find((hit) => hit !== undefined) : undefined)
    if (card === undefined) continue
    byBot.set(bot.id, card)
    owned.add(card.sessionId)
  }
  return { byBot, orphans: cards.filter((card) => !owned.has(card.sessionId)) }
}

/**
 * The `answer` DS Bot's `questionReply` expects: labels it actually offered, one
 * for a single-choice card, and free text only when the card allowed it. Returns
 * undefined when the user picked nothing, so the caller can say so instead of
 * sending an empty answer that DS Bot would refuse.
 */
export function answerFor(card, selected = [], custom = '') {
  if (card === null || typeof card !== 'object' || !Array.isArray(card.options)) return undefined
  const labels = new Set(card.options.map((option) => option.label))
  const picked = (Array.isArray(selected) ? selected : []).filter((label) => typeof label === 'string' && labels.has(label))
  const chosen = card.multiSelect === true ? [...new Set(picked)] : picked.slice(0, 1)
  const own = card.allowCustom === true ? textOf(custom).slice(0, MAX_CUSTOM) : ''
  if (chosen.length === 0 && own === '') return undefined
  return { selected: chosen, ...(own === '' ? {} : { custom: own }) }
}
