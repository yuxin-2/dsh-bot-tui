// Shared probe harness: resolves dsh-TUI and this plugin relative to the repo,
// and gives every probe an isolated HOME under test/.probe-home.
//
// The probes import TypeScript from the sibling dsh-TUI checkout, so they run
// under tsx. Keeping the resolution here means a probe never hard-codes an
// absolute path, and keeps all writes inside the repo.
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { DEFAULT_STATE } from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = resolve(here, '..', '..')
export const dshTuiRoot = resolve(repoRoot, '..', 'dsh-TUI')

export const probeHome = (name) => join(repoRoot, 'test', '.probe-home', name)

// Point HOME, DSH_HOME and DSH_TUI_HOME at a fresh per-probe directory and
// return it. Call this before mounting the scene so state reads and any
// read-marker writes stay inside the repo.
export function resetProbeHome(name) {
  const root = probeHome(name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(join(root, '.dsh', 'bot'), { recursive: true })
  mkdirSync(join(root, '.dsh-tui'), { recursive: true })
  process.env.HOME = root
  process.env.DSH_HOME = join(root, '.dsh')
  process.env.DSH_TUI_HOME = join(root, '.dsh-tui')
  writeFileSync(join(root, '.dsh', 'bot', 'state.json'), JSON.stringify(DEFAULT_STATE))
  return root
}

export { DEFAULT_STATE } from './fixture.mjs'

const tuiRequire = createRequire(join(dshTuiRoot, 'package.json'))
const ReactModule = await import(pathToFileURL(join(dshTuiRoot, 'node_modules/react/index.js')).href)
export const React = ReactModule.default
export const ui = await import(pathToFileURL(join(dshTuiRoot, 'src/ui.ts')).href)
export const { render, ThemeProvider } = ui
export const { viewportLines } = await import(pathToFileURL(join(dshTuiRoot, 'scripts/lib/term-test.mjs')).href)

const scene = await import(pathToFileURL(join(repoRoot, 'src/scene.js')).href)
export const { TeamScene, bindRuntime } = scene
const activity = await import(pathToFileURL(join(repoRoot, 'src/activity.js')).href)
export const { observe, install, activityOf } = activity

const XTermCjs = tuiRequire('@xterm/headless')
export const XTerm = XTermCjs.Terminal ?? XTermCjs
