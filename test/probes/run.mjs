// Run every probe in this directory, plus `node --check` on the shipped sources.
//
// Each probe gets an isolated HOME under test/.probe-home so a probe can never
// read or write the developer's real DS Bot state. The sibling dsh-TUI checkout
// provides React, the Ink renderer and tsx; see README.md (Development).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_STATE } from './fixture.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const dshTuiRoot = resolve(repoRoot, '..', 'dsh-TUI')
const tsxCandidates = [
  join(dshTuiRoot, 'node_modules', '.bin', 'tsx'),
  join(repoRoot, 'node_modules', '.bin', 'tsx'),
]
const tsx = tsxCandidates.find((path) => existsSync(path))

let failures = 0

function pass(label) {
  console.log(`PASS ${label}`)
}

function fail(label, detail) {
  failures += 1
  console.log(`FAIL ${label}`)
  if (detail) {
    const lines = String(detail).trimEnd().split('\n')
    for (const line of lines.slice(-40)) console.log(`     ${line}`)
  }
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, args, { cwd: repoRoot, ...options })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
    }, options.timeout ?? 600000)
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ code: 1, stdout, stderr: stderr + String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
  })
}

if (tsx === undefined) {
  console.error('tsx not found. Run `pnpm install` in the sibling dsh-TUI checkout, or set up test/probes/harness.mjs.')
  process.exit(1)
}

console.log('== node --check ==')
const sources = [
  'src/index.js',
  'src/scene.js',
  'src/controller.js',
  'src/connection.js',
  'src/activity.js',
  'src/watch.js',
  'test/probes/run.mjs',
]
for (const file of sources) {
  const result = await run(process.execPath, ['--check', file])
  if (result.code === 0) pass(`node --check ${file}`)
  else fail(`node --check ${file}`, result.stderr)
}

console.log('\n== probes ==')
const probes = readdirSync(here)
  .filter((name) => name.endsWith('.tsx'))
  .sort()

for (const name of probes) {
  const label = basename(name, '.tsx')
  const home = join(repoRoot, 'test', '.probe-home', label)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(join(home, '.dsh', 'bot'), { recursive: true })
  mkdirSync(join(home, '.dsh-tui'), { recursive: true })
  writeFileSync(join(home, '.dsh', 'bot', 'state.json'), JSON.stringify(DEFAULT_STATE))
  const result = await run(tsx, [join(here, name)], {
    env: {
      ...process.env,
      HOME: home,
      DSH_HOME: join(home, '.dsh'),
      DSH_TUI_HOME: join(home, '.dsh-tui'),
    },
    timeout: 600000,
  })
  if (result.code === 0) pass(label)
  else fail(label, result.stderr || result.stdout)
}

console.log('')
if (failures > 0) {
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
console.log(`all green: ${sources.length} checks, ${probes.length} probes`)