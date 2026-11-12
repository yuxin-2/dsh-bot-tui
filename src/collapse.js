// Collapsed roster groups. This is a view preference, not team state: it lives
// beside the terminal-local read markers under $DSH_TUI_HOME (or ~/.dsh-tui),
// never in DS Bot's state.json, so collapsing a group cannot be seen by another
// host and survives a restart of this terminal.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

function statePath() {
  const home = process.env.DSH_TUI_HOME || join(homedir(), '.dsh-tui')
  return join(home, 'dsh-bot-tui-collapsed.json')
}

/** Section ids the user collapsed, read fresh on every mount. */
export function readCollapsed() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    const ids = Array.isArray(parsed?.sections) ? parsed.sections : []
    return new Set(ids.filter((id) => typeof id === 'string' && id !== ''))
  } catch {
    // Missing or unreadable: everything starts expanded.
    return new Set()
  }
}

/** Persist the collapsed set atomically (temp file + rename). */
export function writeCollapsed(ids) {
  const target = statePath()
  const temp = `${target}.${process.pid}.tmp`
  try {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(temp, JSON.stringify({ sections: [...ids] }))
    renameSync(temp, target)
  } catch {
    // A view preference that cannot be saved is not worth failing the roster.
  }
}