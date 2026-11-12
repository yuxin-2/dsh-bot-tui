// Decided approvals, as this terminal saw them.
//
// DS Bot keeps only the open requests: `approvalsView()` lists the pending map,
// and `answerApproval()` settles an entry and drops it. Nothing survives the
// answer — no log in state.json, no table in the chat index. So this process
// keeps its own short tail of settled approvals (time, target, request, outcome)
// for the `a` panel's history view. It is terminal-local by design: never
// written to disk, never shared with another window, and lost when the TUI
// exits. The UI says so.
const MAX_RECORDS = 50

let records = []
const listeners = new Set()

function emit() {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // One broken subscriber must not stop the others.
    }
  }
}

/** Subscribe to history changes; returns the unsubscribe function. */
export function subscribeApprovalHistory(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Record one settled approval. `entry` carries the open request's fields plus
 * `outcome` and `decidedAt`. Re-recording the same id replaces the row, so a
 * TUI answer and DS Bot's own `settled` event cannot duplicate it.
 */
export function recordApproval(entry) {
  if (entry === undefined || entry === null) return undefined
  const id = entry.id ?? `${entry.sessionId ?? '?'}-${entry.decidedAt ?? Date.now()}`
  const record = { ...entry, id }
  records = [record, ...records.filter((row) => row.id !== id)].slice(0, MAX_RECORDS)
  emit()
  return record
}

/** Newest first. Callers must treat the rows as read-only. */
export function approvalHistory() {
  return records
}

/** Drop the tail; used by probes and by a fresh process. */
export function resetApprovalHistory() {
  records = []
  emit()
}