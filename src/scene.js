// The Bot team scene: a full-screen roster for the DS Bot team.
//
// Reading state.json is deliberate: the DS Bot host plugin (mounted on the row
// next to this one) owns writes and keeps the file atomic (one temp file +
// rename), so a read-only reader always sees a complete revision. Live status
// and unread marks come from `activity.js`, which folds the session stream this
// process already sees.
//
// Chat is the ordinary dsh-TUI Chat screen: Enter resumes the Bot's own Session,
// so the Bot's persona, memory and team tools apply to the turn DSH runs there.
// A message sent with `m` goes to the Bot without leaving the roster.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { activityOf, markSeen, subscribe, unreadOf } from './activity.js'

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
  const team = { bots: [], pending: [], revision: undefined, mainId: undefined, error: '', foreign: undefined }

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
      capabilities: Array.isArray(bot.capabilities) ? bot.capabilities : [],
    }))
    team.pending = Object.values(state.capabilities?.items ?? {})
      .filter((item) => item?.kind === 'mcp' && item.transport === 'stdio' && item.approved !== true)
      .map((item) => ({ name: item.name, description: item.description ?? '', createdBy: item.createdBy ?? '' }))
  } catch (error) {
    team.error = error?.code === 'ENOENT'
      ? `还没有团队：${statePath} 不存在。按 n 创建第一位 Main Bot。`
      : `读取团队失败：${error?.message ?? error}`
  }

  // A live lock held by another process means this terminal may only read.
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

function elapsed(since) {
  const seconds = Math.max(0, Math.round((Date.now() - Number(since ?? Date.now())) / 1000))
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
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

function pad(text, width) {
  const value = String(text ?? '')
  if (value.length >= width) return `${value.slice(0, width - 1)}…`
  return value.padEnd(width)
}

export function TeamScene(props) {
  const { React, ui, channel, close } = props
  const { Box, Text, useInput, useTerminalSize } = ui
  const h = React.createElement

  const [team, setTeam] = React.useState(readTeam)
  const [index, setIndex] = React.useState(0)
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [mode, setMode] = React.useState('list')
  const [draft, setDraft] = React.useState('')
  const [pendingDelete, setPendingDelete] = React.useState(undefined)
  const [approveIndex, setApproveIndex] = React.useState(0)
  const [, rerender] = React.useReducer((n) => n + 1, 0)
  const { columns, rows } = useTerminalSize()

  React.useEffect(() => {
    const timer = setInterval(() => setTeam(readTeam()), 1000)
    return () => clearInterval(timer)
  }, [])
  React.useEffect(() => subscribe(rerender), [])

  // Whatever session the terminal is on when the roster opens is read.
  React.useEffect(() => markSeen(channel.sessionId), [])

  const bots = team.bots
    .map((bot) => ({
      ...bot,
      live: activityOf(bot.sessionId),
      unread: unreadOf(bot.sessionId),
    }))
    .sort((a, b) => {
      const rank = (bot) => (bot.main ? 0 : bot.live?.status === 'needs-input' ? 1 : bot.live?.status === 'working' ? 2 : bot.unread > 0 ? 3 : 4)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })

  const count = bots.length
  const working = bots.filter((bot) => bot.live?.status === 'working').length
  const waiting = bots.filter((bot) => bot.live?.status === 'needs-input').length
  const unread = bots.reduce((total, bot) => total + bot.unread, 0)
  const current = count === 0 ? undefined : bots[Math.min(index, count - 1)]
  const here = bots.find((bot) => bot.sessionId === channel.sessionId)
  const listHeight = Math.max(1, Math.min(count, rows - 11))
  const offset = Math.max(0, Math.min(index - listHeight + 1, count - listHeight))

  const open = async (bot) => {
    if (bot === undefined || busy) return
    setBusy(true)
    setNotice('')
    try {
      markSeen(bot.sessionId)
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

  const send = async (bot, text) => {
    const rt = runtime()
    if (rt === undefined) throw new Error('DS Bot 运行时还没就绪')
    const live = rt.live?.has?.(bot.sessionId) ?? false
    if (live) {
      await rt.sendUser({ sessionId: bot.sessionId, content: [{ type: 'text', text }] })
      return
    }
    // Not mounted yet: mount it so the Bot's preset composes the agent, submit,
    // then hand the view back. A parked turn keeps running.
    const previous = channel.sessionId
    const mounted = await channel.resumeTo(bot.sessionId)
    if (!mounted?.ok) throw new Error(reason(mounted))
    channel.submit(text)
    if (previous !== undefined && previous !== bot.sessionId) {
      await channel.resumeTo(previous)
    }
  }

  // Prefer the route this terminal already runs, but only when the catalog
  // really serves it: a copied profile can name a provider this DSH_HOME has no
  // credentials for, and then every Bot would start on a dead route.
  const pickModel = async (rt) => {
    const live = channel.provider && channel.model ? `${channel.provider}/${channel.model}` : undefined
    if (live !== undefined) {
      try {
        await rt.resolveModel(live)
        return live
      } catch {
        // Fall through to DS Bot's own default.
      }
    }
    return rt.defaultBotModel?.()
  }

  const createBot = async (text) => {
    const rt = runtime()
    if (rt === undefined) throw new Error('DS Bot 运行时还没就绪')
    const [rawName, ...rest] = text.split(/[,，]/)
    const name = rawName?.trim() ?? ''
    if (name === '') throw new Error('名字不能为空')
    const role = rest.join(',').trim().slice(0, 24)
    const model = await pickModel(rt)
    await ensureWritable(rt)
    const created = await rt.createBot({ name, role, ...(model === undefined ? {} : { model }) })
    const next = readTeam()
    setTeam(next)
    const at = next.bots.findIndex((bot) => bot.id === created.id)
    if (at >= 0) setIndex(at)
  }

  const stopBot = async (bot) => {
    const rt = runtime()
    if (rt?.stopChat === undefined) {
      setNotice('无法停止：DS Bot 运行时未就绪')
      return
    }
    if (bot.id === undefined) return
    try {
      await rt.stopChat(bot.id)
      setNotice(`已请求停止 ${bot.name}`)
    } catch (error) {
      setNotice(`停止失败：${error?.message ?? error}`)
    }
  }

  const deleteBot = async (bot) => {
    const rt = runtime()
    if (rt?.deleteBot === undefined) {
      setNotice('无法删除：DS Bot 运行时未就绪')
      return
    }
    try {
      await ensureWritable(rt)
      await rt.deleteBot(bot.id)
      setNotice(`已删除 ${bot.name}`)
      setPendingDelete(undefined)
      setTeam(readTeam())
    } catch (error) {
      setNotice(`删除失败：${error?.message ?? error}`)
      setPendingDelete(undefined)
    }
  }

  const ensureWritable = async (rt) => {
    await rt.load?.()
    await rt.refresh?.()
    if (typeof rt.readOnly === 'function' && rt.readOnly() !== undefined) {
      throw new Error(rt.readOnly())
    }
  }

  const approve = async (capability) => {
    const rt = runtime()
    if (rt?.capabilityEndpoint === undefined) {
      setNotice('无法授权：DS Bot 运行时未就绪')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await ensureWritable(rt)
      await rt.capabilityEndpoint('capability-approve', { name: capability.name })
      // Mount it now for every Bot that already has it attached, so the next
      // turn sees the tools without a restart.
      for (const bot of team.bots) {
        if (bot.capabilities.includes(capability.name)) {
          await rt.ensureCapabilities?.(bot.sessionId).catch(() => {})
        }
      }
      setTeam(readTeam())
      setMode('list')
      setNotice(`已授权 ${capability.name}，下次对话就会挂载。`)
    } catch (error) {
      setNotice(`授权失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const createChief = async () => {
    if (busy) return
    if (count > 0) {
      setNotice('团队已经在了：按 c 新建 Bot，或让 Chief 来建。')
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
      await ensureWritable(rt)
      await rt.syncModels?.()
      const model = await pickModel(rt)
      await rt.createBot({
        name: rt.defaults?.mainName ?? 'Chief',
        role: rt.defaults?.mainRole ?? 'Chief of Staff',
        main: true,
        color: 'deepseek',
        avatar: { shape: 'whale' },
        ...(model === undefined ? {} : { model }),
      })
      setTeam(readTeam())
      setNotice('已创建 Chief。')
    } catch (error) {
      setNotice(`创建失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const submitDraft = async () => {
    const text = draft.trim()
    if (text === '') return
    setBusy(true)
    setNotice('')
    try {
      if (mode === 'message') {
        await send(current, text)
        setNotice(`已发给 ${current.name}；它开工时列表会亮起来。`)
      } else {
        await createBot(text)
        setNotice('已创建。')
      }
      setDraft('')
      setMode('list')
    } catch (error) {
      setNotice(`${mode === 'message' ? '发送' : '创建'}失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  useInput((input, key) => {
    if (mode === 'approve') {
      if (key.escape) {
        setMode('list')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setApproveIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setApproveIndex((at) => Math.min(team.pending.length - 1, at + 1))
        return
      }
      if (key.return && team.pending[approveIndex] !== undefined) {
        void approve(team.pending[approveIndex])
      }
      return
    }
    if (mode !== 'list') {
      if (key.escape) {
        setMode('list')
        setDraft('')
        setNotice('')
        return
      }
      if (key.return) {
        void submitDraft()
        return
      }
      if (key.backspace || key.delete) {
        setDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        setDraft((at) => (at + input).slice(0, 400))
      }
      return
    }

    if (key.escape || input === 'q') {
      close()
      return
    }
    if (key.upArrow || input === 'k') {
      setIndex((at) => Math.max(0, Math.min(at, count - 1) - 1))
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (key.downArrow || input === 'j') {
      setIndex((at) => Math.min(Math.max(0, count - 1), at + 1))
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (input === 'r') {
      setTeam(readTeam())
      setNotice('')
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
    if (input === 'n') {
      void createChief()
      return
    }
    if (input === 'm' && current !== undefined) {
      setMode('message')
      setDraft('')
      setNotice('')
      return
    }
    if (input === 'p') {
      if (team.pending.length === 0) {
        setNotice('没有待授权的 MCP 能力。')
        return
      }
      setApproveIndex(0)
      setMode('approve')
      setNotice('')
      return
    }
    if (input === 'c') {
      setMode('create')
      setDraft('')
      setNotice('')
      return
    }
    if (input === 's' && current !== undefined) {
      void stopBot(current)
      return
    }
    if (input === 'x' && current !== undefined) {
      if (pendingDelete === current.id) void deleteBot(current)
      else {
        setPendingDelete(current.id)
        setNotice(current.main ? 'Main Bot 不能删除；再按 x 也只会报错。' : `再按一次 x 删除 ${current.name}（不可恢复）`)
      }
      return
    }
    if (key.return && current !== undefined) {
      void open(current)
    }
  })

  const statusOf = (bot) => {
    if (bot.live?.status === 'working') return { text: `工作中 ${elapsed(bot.live.since)}`, color: 'accent' }
    if (bot.live?.status === 'needs-input') return { text: '待回答', color: 'warning' }
    return { text: '空闲', color: 'subtle' }
  }

  const header = h(Box, { key: 'header', flexDirection: 'column' },
    h(Text, null,
      h(Text, { bold: true, color: 'accent' }, ' DS Bot '),
      h(Text, { color: 'subtle' }, ` ${count} 位`),
      working > 0 ? h(Text, { color: 'accent' }, ` · 工作 ${working}`) : null,
      waiting > 0 ? h(Text, { color: 'warning' }, ` · 待回答 ${waiting}`) : null,
      unread > 0 ? h(Text, { color: 'success' }, ` · 未读 ${unread}`) : null,
      team.pending.length > 0 ? h(Text, { color: 'warning' }, ` · 待授权 ${team.pending.length}`) : null,
      here === undefined ? null : h(Text, { color: 'success' }, ` · 当前 ${here.name}`),
      columns >= 96 ? h(Text, { color: 'inactive' }, `   ${channel.provider}/${channel.model}`) : null,
    ),
    team.foreign === undefined
      ? null
      : h(Text, { color: 'warning' }, `⚠ 另一个 DS Bot 持有团队锁（pid ${team.foreign.pid}），本终端只读。`),
    team.error === '' ? null : h(Text, { color: 'error' }, team.error),
  )

  const rowsView = []
  for (let at = offset; at < Math.min(offset + listHeight, count); at += 1) {
    const bot = bots[at]
    const selected = at === index
    const status = statusOf(bot)
    rowsView.push(h(Box, { key: bot.id, flexDirection: 'row' },
      h(Text, { color: selected ? 'accent' : 'subtle' }, selected ? ' ❯ ' : '   '),
      h(Text, { color: bot.main ? 'accent' : 'text' }, bot.main ? `${MAIN_MARK} ` : '  '),
      h(Text, { bold: selected, color: selected ? 'accent' : 'text' }, pad(bot.name, 13)),
      h(Text, { color: 'subtle' }, pad(bot.role || '—', 16)),
      h(Text, { color: status.color }, pad(status.text, 10)),
      bot.sessionId === channel.sessionId ? h(Text, { color: 'success' }, ' 当前') : bot.unread > 0 ? h(Text, { color: 'success' }, ' ●新') : null,
      bot.blocked === undefined ? null : h(Text, { color: 'error' }, ` ${bot.blocked}`),
      bot.waiting ? h(Text, { color: 'warning' }, ' 待开场') : null,
    ))
  }

  const detail = current === undefined ? null : h(Box, { key: 'detail', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'subtle' }, '─'.repeat(Math.max(8, Math.min(columns - 2, 56)))),
    h(Text, null,
      h(Text, { bold: true, color: 'accent' }, current.name),
      h(Text, { color: 'subtle' }, ` · ${current.role || '无角色'}`),
      current.model === '' ? null : h(Text, { color: 'inactive' }, ` · ${current.model}`),
      current.workDir === '' ? null : h(Text, { color: 'inactive' }, ` · ${current.workDir}`),
    ),
    current.live?.lastText
      ? h(Text, { color: 'subtle' }, `最近：${current.live.lastText}`)
      : null,
  )

  const approveView = mode !== 'approve' ? null : h(Box, { key: 'approve', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '待授权的 MCP 能力（Enter 批准，Esc 返回）'),
    ...team.pending.map((item, at) => h(Box, { key: item.name, flexDirection: 'row' },
      h(Text, { color: at === approveIndex ? 'accent' : 'subtle' }, at === approveIndex ? ' ❯ ' : '   '),
      h(Text, { bold: at === approveIndex, color: at === approveIndex ? 'accent' : 'text' }, pad(item.name, 16)),
      h(Text, { color: 'subtle' }, item.description),
    )),
    notice === '' ? null : h(Text, { color: 'warning' }, notice),
    h(Text, { color: 'inactive' }, '批准后会立即挂载给已绑定它的 Bot；首次启动 MCP 可能慢几秒。'),
  )

  const footer = mode === 'approve'
    ? approveView
    : mode === 'list'
    ? h(Box, { key: 'footer', flexDirection: 'column', marginTop: 1 },
      busy ? h(Text, { color: 'accent' }, '处理中…') : null,
      notice === '' ? null : h(Text, { color: 'warning' }, notice),
      h(Text, { color: 'subtle' }, '↑↓ 选择 · Enter 聊天 · m 发消息 · r 刷新'),
      h(Text, { color: 'subtle' }, `c 新建 · s 停止 · x 删除 · q 返回${team.pending.length > 0 ? ' · p 授权' : ''}`),
      h(Text, { color: 'inactive' }, '进入聊天后人格、记忆、团队工具都由 Bot 运行时接管。'),
    )
    : h(Box, { key: 'footer', flexDirection: 'column', marginTop: 1 },
      h(Text, { color: 'accent' }, mode === 'message' ? `发给 ${current?.name ?? '?'}（输入后 Enter 发送，Esc 取消）` : '新建 Bot（名称,角色，例如 Dev,编码）'),
      h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, draft === '' ? ' ' : draft)),
      notice === '' ? null : h(Text, { color: 'warning' }, notice),
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
