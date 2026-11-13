// Roster layout preference (compact vs normal). This is a view preference, not
// team state: it lives beside the terminal-local read markers under
// $DSH_TUI_HOME (or ~/.dsh-tui), never in DS Bot's state.json, so it survives a
// restart of this terminal without being visible to another host.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function statePath() {
  const home = process.env.DSH_TUI_HOME || join(homedir(), '.dsh-tui')
  return join(home, 'dsh-bot-tui-layout.json')
}

/** The saved compact flag, or undefined when the user has never chosen one. */
export function readCompact() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    return typeof parsed?.compact === 'boolean' ? parsed.compact : undefined
  } catch {
    // Missing or unreadable: fall back to the terminal width.
    return undefined
  }
}

/** Persist the layout preference atomically (temp file + rename). */
export function writeCompact(compact) {
  const target = statePath()
  const temp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, JSON.stringify({ compact: compact === true }))
    renameSync(temp, target)
  } catch {
    // A view preference that cannot be saved is not worth failing the roster.
  }
}
