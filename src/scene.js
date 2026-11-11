// The Bot team scene: a full-screen list of the DS Bot team.
//
// Reading state.json is deliberate: the DS Bot host plugin (mounted on the row
// next to this one) owns writes and keeps the file atomic (one temp file +
// rename), so a read-only reader always sees a complete revision. Chat itself
// is the ordinary dsh-TUI Chat screen: Enter resumes the Bot's own Session, so
// the Bot's persona, memory and team tools apply to the turn DSH runs there.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAIN_MARK = '★'

// The DS Bot runtime, published by its `ctx.provide('dsBot', rt)` row. Bound
// lazily: the row order inside a profile is not a promise that the plugin has
// applied by the time this row registers its scene.
let runtime = () => undefined

export function bindRuntime(get) {
  runtime = get
}

function dshHome() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

/** Read the team without touching the DS Bot lock or the runtime. */
export function readTeam() {
  const home = join(dshHome(), 'bot')
  const statePath = join(home, 'state.json')
  const lockPath = join(home, 'state.lock')
  const team = { bots: [], revision: undefined, mainId: undefined, error: '', foreign: undefined }

  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'))
    const mains = Array.isArray(state.mainBotIds) ? state.mainBotIds : []
    team.mainId = mains[0]
    team.revision = state.revision
    team.bots = Object.values(state.bots ?? {}).map((bot) => ({
      id: bot.id,
      name: bot.name ?? bot.id,
      role: bot.role ?? '',
      model: bot.model ?? bot.appliedModel ?? '',
      sessionId: bot.sessionId ?? bot.id,
      main: mains.includes(bot.id),
      blocked: bot.blocked?.code,
      waiting: bot.kickoff !== undefined,
      workDir: bot.workDir ?? '',
    }))
    team.bots.sort((a, b) => Number(b.main) - Number(a.main) || a.name.localeCompare(b.name))
  } catch (error) {
    team.error = error?.code === 'ENOENT'
      ? `还没有团队：${statePath} 不存在。先在 DS Bot 的桌面端或网页端创建团队，再回到这里。`
      : `读取团队失败：${error?.message ?? error}`
  }

  // A live lock held by another process means this terminal may only read: the
  // DS Bot host here turns read-only, so a chat turn could run but not persist.
  try {
    if (existsSync(lockPath)) {
      const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
      if (Number(lock.pid) > 0 && Number(lock.pid) !== process.pid && alive(Number(lock.pid))) {
        team.foreign = { pid: Number(lock.pid), host: String(lock.host ?? '') }
      }
    }
  } catch {
    // A half-written lock is not worth failing the list over.
  }
  return team
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function reason(result) {
  switch (result?.reason) {
    case 'occupied': return `会话被另一个终端占用（pid ${result.pid}）`
    case 'working': return '会话正在运行，稍后再试'
    case 'unavailable': return '当前后端不支持恢复会话'
    case 'cancelled': return '切换被取消'
    case 'failed': return `恢复失败：${result.error ?? 'unknown'}`
    default: return '恢复失败'
  }
}

export function TeamScene(props) {
  const { React, ui, channel, close } = props
  const { Box, Text, useInput, useTerminalSize } = ui
  const h = React.createElement

  const [team, setTeam] = React.useState(readTeam)
  const [index, setIndex] = React.useState(0)
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const { columns, rows } = useTerminalSize()

  React.useEffect(() => {
    const timer = setInterval(() => setTeam(readTeam()), 900)
    return () => clearInterval(timer)
  }, [])

  const count = team.bots.length
  const current = count === 0 ? undefined : team.bots[Math.min(index, count - 1)]
  const listHeight = Math.max(1, Math.min(count, rows - 9))
  const offset = Math.max(0, Math.min(index - listHeight + 1, count - listHeight))

  const open = async (bot) => {
    if (bot === undefined || busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await channel.resumeTo(bot.sessionId)
      if (result?.ok) {
        close()
        return
      }
      setNotice(reason(result))
    } catch (error) {
      setNotice(`恢复失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const createChief = async () => {
    if (busy) return
    if (count > 0) {
      setNotice('团队已经在了：新建 Bot 直接在聊天里跟 Chief 说，或删掉 ~/.dsh/bot 重来。')
      return
    }
    const rt = runtime()
    if (rt === undefined) {
      setNotice('DS Bot 运行时还没就绪，稍后再试')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await rt.load?.()
      await rt.syncModels?.()
      // The terminal already runs one route: a Bot made here starts on it, so
      // the first greeting does not fail on a different provider's quota.
      const live = channel.provider && channel.model ? `${channel.provider}/${channel.model}` : undefined
      const model = live ?? await rt.defaultBotModel?.()
      await rt.createBot({
        name: rt.defaults?.mainName ?? 'Chief',
        role: rt.defaults?.mainRole ?? 'Chief of Staff',
        main: true,
        color: 'deepseek',
        avatar: { shape: 'whale' },
        ...(model === undefined ? {} : { model }),
      })
      setTeam(readTeam())
      setNotice(model === undefined
        ? '已创建 Chief；还没有可用模型，先在 /settings 里配一个模型再开始聊天。'
        : '已创建 Chief，按 Enter 进入聊天。')
    } catch (error) {
      setNotice(`创建失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      close()
      return
    }
    if (key.upArrow || input === 'k') {
      setIndex((at) => Math.max(0, Math.min(at, count - 1) - 1))
      return
    }
    if (key.downArrow || input === 'j') {
      setIndex((at) => Math.min(Math.max(0, count - 1), at + 1))
      return
    }
    if (input === 'r') {
      setTeam(readTeam())
      setNotice('')
      return
    }
    if (input === 'n') {
      void createChief()
      return
    }
    if (input === 'g') {
      setIndex(0)
      return
    }
    if (input === 'G') {
      setIndex(Math.max(0, count - 1))
      return
    }
    if (key.return) {
      void open(current)
    }
  })

  const header = h(Box, { key: 'header', flexDirection: 'column' },
    h(Text, null,
      h(Text, { bold: true, color: 'accent' }, ' DS Bot '),
      h(Text, { color: 'subtle' }, ` ${count} 位 · 终端 › ${channel.sessionId.slice(0, 8)} `),
      team.revision === undefined ? null : h(Text, { color: 'inactive' }, `rev ${team.revision} `),
    ),
    team.foreign === undefined
      ? null
      : h(Text, { color: 'warning' }, `⚠ 另一个 DS Bot 持有团队锁（pid ${team.foreign.pid}），本终端只读；聊天可以继续，但状态可能不会落盘。`),
    team.error === '' ? null : h(Text, { color: 'error' }, team.error),
  )

  const rowsView = []
  for (let at = offset; at < Math.min(offset + listHeight, count); at += 1) {
    const bot = team.bots[at]
    const selected = at === index
    const here = bot.sessionId === channel.sessionId
    rowsView.push(h(Box, { key: bot.id, flexDirection: 'row' },
      h(Text, { color: selected ? 'accent' : 'subtle' }, selected ? ' ❯ ' : '   '),
      h(Text, { color: bot.main ? 'accent' : 'text' }, bot.main ? `${MAIN_MARK} ` : '  '),
      h(Text, { bold: selected, color: selected ? 'accent' : 'text' }, bot.name.padEnd(12).slice(0, 12)),
      h(Text, { color: 'subtle' }, `${(bot.role || '—').padEnd(14).slice(0, 14)}`),
      h(Text, { color: here ? 'success' : 'inactive' }, here ? '当前会话' : `${bot.sessionId.slice(0, 8)}`),
      bot.model === '' ? null : h(Text, { color: 'inactive' }, `  ${bot.model}`),
      bot.blocked === undefined ? null : h(Text, { color: 'error' }, `  blocked:${bot.blocked}`),
      bot.waiting ? h(Text, { color: 'warning' }, '  待开场') : null,
    ))
  }

  const detail = current === undefined ? null : h(Box, { key: 'detail', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'subtle' }, '─'.repeat(Math.max(8, Math.min(columns - 2, 64)))),
    h(Text, null,
      h(Text, { bold: true, color: 'accent' }, current.name),
      h(Text, { color: 'subtle' }, ` · ${current.role || '无角色'}`),
      h(Text, { color: 'inactive' }, ` · session ${current.sessionId}`),
    ),
    current.workDir === '' ? null : h(Text, { color: 'inactive' }, `workspace ${current.workDir}`),
  )

  const footer = h(Box, { key: 'footer', flexDirection: 'column', marginTop: 1 },
    busy ? h(Text, { color: 'accent' }, '正在切换到该 Bot 的会话…') : null,
    notice === '' ? null : h(Text, { color: 'error' }, notice),
    h(Text, { color: 'subtle' }, '↑/↓ 选择 · Enter 进入聊天 · n 建 Chief · r 刷新 · g/G 首/末 · q 返回'),
    h(Text, { color: 'inactive' }, '进入后就是普通的 dsh-TUI 会话：人格、记忆、团队工具都由 Bot 运行时接管。'),
  )

  const empty = count === 0
    ? h(Text, { color: 'subtle' }, '还没有团队 · 按 n 创建第一位 Main Bot（Chief）')
    : h(Box, { flexDirection: 'column' }, rowsView)

  return h(Box, { flexDirection: 'column', width: '100%', paddingX: 1 },
    header,
    h(Box, { key: 'list', flexDirection: 'column', marginTop: 1 }, empty),
    detail,
    h(Box, { flexGrow: 1 }),
    footer,
  )
}
