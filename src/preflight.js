// Startup checks for the roster. The DS Bot host is optional in the sense that
// the read-only roster still renders without it, but several actions silently
// degrade when it is missing. These checks turn that into one actionable line.
import { readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DS_BOT_PACKAGE = 'ds-bot'
export const DS_BOT_COMPAT_RANGE = '0.3.x'

function packageVersionAt(file, name) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed?.name === name && typeof parsed.version === 'string' && parsed.version !== '') return parsed.version
  } catch {
    // A missing or unreadable manifest is an unknown version, not a crash.
  }
  return undefined
}

function walk(dir, name) {
  const candidates = []
  for (let at = 0; at < 12; at += 1) {
    candidates.push(join(dir, 'node_modules', name, 'package.json'))
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return candidates
}

let cache
/** Read the installed DS Bot package version from the profile or checkout. */
export function readDsBotVersion() {
  if (cache !== undefined) return cache
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [resolve(here, '..', '..', 'DS-Bot', 'ds-bot', 'package.json')]
  const starts = [here, process.cwd()]
  if (typeof process.argv[1] === 'string' && process.argv[1] !== '') starts.push(dirname(resolve(process.argv[1])))
  for (const start of starts) candidates.push(...walk(start, DS_BOT_PACKAGE))
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  for (const root of [join(home, 'profiles'), join(homedir(), '.dsh', 'profiles')]) {
    try {
      for (const name of readdirSync(root)) candidates.push(join(root, name, 'node_modules', DS_BOT_PACKAGE, 'package.json'))
    } catch {
      // No profile directory here.
    }
  }
  for (const file of candidates) {
    const version = packageVersionAt(file, DS_BOT_PACKAGE)
    if (version !== undefined) {
      cache = { version, file }
      return cache
    }
  }
  cache = null
  return null
}

export function dsBotCompat(version) {
  const match = /^(\d+)\.(\d+)\./.exec(String(version ?? ''))
  if (match === null) return undefined
  return Number(match[1]) === 0 && Number(match[2]) === 3
}

/**
 * Pure preflight check. `services` is left undefined when the host was not
 * bound (older embeds); the actual plugin binds it in index.js.
 */
export function checkPreflight({ runtime, services, team, dsBotVersion }) {
  const issues = []
  if (runtime === undefined) {
    issues.push({
      key: 'runtime', tone: 'error',
      message: '未应用 dsBot 运行时补丁，创建团队不可用：见 README 的 one-row patch',
    })
  }
  const stateError = String(team?.error ?? '')
  if (stateError !== '' && !stateError.includes('不存在')) {
    issues.push({
      key: 'state', tone: 'error',
      message: '团队状态不可读：检查 $DSH_HOME/bot/state.json 后按 r 重读。',
      detail: stateError,
    })
  }
  // A missing package manifest is an unknown version, not a roster failure.
  // The health panel reports it; the roster must not block on it.
  if (dsBotVersion !== null && dsBotVersion !== undefined && dsBotCompat(dsBotVersion.version) !== true) {
    issues.push({
      key: 'dsbot-version', tone: 'warn',
      message: `DS Bot ${dsBotVersion.version} 不在 ${DS_BOT_COMPAT_RANGE} 范围内：按 README 安装匹配版本。`,
    })
  }
  if (services !== undefined && (
    typeof services.commands?.register !== 'function' ||
    typeof services.tuiScenes?.register !== 'function'
  )) {
    issues.push({
      key: 'services', tone: 'error',
      message: 'dsh-TUI 必要服务不全（commands/tuiScenes）：升级 dsh-TUI 或检查 profile。',
    })
  }
  return issues
}
