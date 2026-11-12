// The roster is a read-only viewer of `$DSH_HOME/bot/state.json`. DS Bot saves
// by writing a temp file in the same directory and renaming it over the target,
// so the directory is the stable thing to watch: a watch on the file itself is
// replaced by the rename (the inode changes) and goes quiet or reports errors.
// Watching the directory keeps working across those atomic swaps, and a reader
// only ever sees a complete revision.
//
// Some filesystems (and some remote/synced homes) cannot watch at all. If
// `watch()` throws, or the watcher later emits an error, fall back to polling
// every `fallback` ms. Both paths are released by `close()`.
import { watch as fsWatch } from 'node:fs'

export function watchTeam(onChange, options = {}) {
  const {
    home,
    delay = 120,
    fallback = 1500,
    watchImpl = fsWatch,
  } = options

  let watcher
  let debounce
  let polling
  let closed = false

  const read = () => {
    if (closed) return
    try {
      onChange()
    } catch {
      // A failed read must not kill the watcher; the next change retries.
    }
  }

  const stopWatcher = () => {
    if (watcher === undefined) return
    const current = watcher
    watcher = undefined
    try {
      current.close()
    } catch {
      // Already closed.
    }
  }

  const startPolling = () => {
    if (polling !== undefined || closed) return
    polling = setInterval(read, fallback)
  }

  const schedule = () => {
    if (closed) return
    clearTimeout(debounce)
    debounce = setTimeout(read, delay)
  }

  try {
    watcher = watchImpl(home, { persistent: false }, () => schedule())
    watcher.on('error', () => {
      stopWatcher()
      startPolling()
    })
  } catch {
    startPolling()
  }

  return {
    close() {
      if (closed) return
      closed = true
      clearTimeout(debounce)
      stopWatcher()
      if (polling !== undefined) {
        clearInterval(polling)
        polling = undefined
      }
    },
  }
}