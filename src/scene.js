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
import { activityOf, clearFailure, markSeen, subscribe, unreadOf } from './activity.js'
import { approvalHistory, recordApproval, subscribeApprovalHistory } from './approvalHistory.js'
import { watchTeam } from './watch.js'

const MAIN_MARK = '★'

// The browser's avatar shape set and Bot palette (DS Bot client), copied here so
// the settings form does not reach into the DS Bot bundle's private modules.
const AVATAR_SHAPES = [
  'whale', 'star', 'moon', 'wave', 'squircle', 'zed', 'hex', 'gumdrop',
  'peanut', 'saucer', 'bunny', 'kitty', 'beacon', 'plus', 'magnet', 'acorn',
  'pebbles', 'cushion', 'ring', 'gem',
]
const BOT_COLORS = [
  'deepseek', 'blue', 'violet', 'orange', 'green', 'magenta', 'cyan', 'red',
  'yellow', 'brown', 'gray', 'black', 'aurora', 'charcoal', 'graphite', 'rose',
  'sky', 'tangerine', 'cobalt',
]
const COMPUTER_LEVELS = [
  { id: 'off', name: '关闭' },
  { id: 'view', name: '仅查看' },
  { id: 'background', name: '后台' },
  { id: 'foreground', name: '前台' },
]
const BROWSER_KINDS = ['post', 'upload', 'download', 'delete', '*']

// One place for the key hints, so every mode has a footer line and the help
// overlay cannot drift from what the roster actually accepts. `?` opens the
// grouped view built from the same list.
export const HELP_SECTIONS = [
  {
    title: '名册',
    keys: [
      ['↑/↓ 或 k/j', '移动光标'],
      ['g / G', '跳到首位 / 末位'],
      ['Enter', '进入该 Bot 的聊天'],
      ['m', '不离开面板给 Bot 发消息'],
      ['s', '停止该 Bot 当前的回合'],
      ['x', '删除（连按两次确认）'],
      ['X', '清除选中 Bot 的失败记录'],
      ['space', '折叠 / 展开详情'],
      ['/', '按名称或标签搜索'],
      ['a', '回答待审批的请求'],
      ['a → h', '查看本终端已决审批'],
      ['p', '批准待授权的 MCP 能力'],
      ['v', '挂载 / 卸载当前 Bot 的能力'],
      ['u', '释放本终端对该会话的占用'],
      ['n', '空团队时创建 Chief'],
      ['r', '重读 state.json'],
      ['?', '打开 / 关闭本帮助'],
      ['q / Esc', '返回聊天（先清除搜索）'],
    ],
  },
  {
    title: 'Bot 设置',
    keys: [
      ['e', '编辑当前 Bot 的设置'],
      ['资料 / 头像 / 颜色', '名称、标签、形状或图片路径、配色'],
      ['模型 / 思考级别', '选择模型与推理档位'],
      ['权限', 'DSH 权限预设'],
      ['指令 / 目录', '系统提示词与工作目录'],
      ['私密 / 置顶 / 隐藏', '控制名册中的可见性'],
      ['分组', '在侧边栏分组间移动'],
      ['Computer / Browser', '按级别授权与按站点授权'],
      ['复制 / 删除', '复制配置或删除 Bot'],
      ['Esc', '返回名册'],
    ],
  },
  {
    title: '群聊',
    keys: [
      ['t', '打开群聊列表'],
      ['Enter', '打开选中的群聊'],
      ['n', '从 Bot 勾选新建群聊'],
      ['e', '群设置（成员、管理员、回复模式）'],
      ['x', '删除群聊（连按两次）'],
      ['Esc', '返回名册'],
    ],
  },
  {
    title: '记忆',
    keys: [
      ['e → 记忆', '打开当前 Bot 的记忆面板'],
      ['a', '用自然语言提问增改删条目'],
      ['Enter', '编辑选中的条目（Ctrl+Enter 换行）'],
      ['p', '置顶 / 取消置顶'],
      ['l', '在私有记忆与团队记忆间移动'],
      ['m', '移动到其它 Bot / 群聊 / 团队记忆'],
      ['t', '撤销上次整理'],
      ['h', '变更记录（Enter 恢复，n 更早）'],
      ['x', '忘记选中的条目（再按一次）'],
      ['r', '刷新记忆'],
      ['Esc', '返回名册'],
    ],
  },
  {
    title: '定时',
    keys: [
      ['e → 定时', '打开当前 Bot 的定时任务'],
      ['n', '新建（每天 / 每周 1–7 / 每隔 / 一次）'],
      ['x', '删除选中的任务'],
      ['r', '刷新列表'],
      ['Esc', '返回名册'],
    ],
  },
  {
    title: 'Computer',
    keys: [
      ['o', '打开 Computer 面板'],
      ['Enter', '切换总开关 / 重试提供方'],
      ['e → Computer', '设置该 Bot 的访问级别'],
      ['x', '撤销已授权的应用'],
      ['Esc', '返回名册'],
    ],
  },
  {
    title: '用量',
    keys: [
      ['y', '查看当前 Bot 的 token 用量'],
      ['d / w / m', '按一天 / 一周 / 一月汇总'],
      ['r', '刷新统计'],
      ['Esc', '返回名册'],
    ],
  },
]

const HELP_ENTRIES = HELP_SECTIONS.flatMap((section) => [
  { kind: 'title', text: section.title },
  ...section.keys.map(([key, description]) => ({ kind: 'row', key, description })),
])

export const MODE_HINTS = {
  list: '↑↓ 选择 · Enter 聊天 · m 发消息 · r 刷新 · / 搜索 · ? 帮助',
  search: '输入筛选 · Enter 确认 · Esc 清除',
  help: '↑↓ 滚动 · Esc 返回',
  create: 'Enter 创建 · Esc 取消',
  message: 'Enter 发送 · Esc 取消',
  edit: '↑↓ 选择 · Enter 修改 · Esc 返回',
  field: 'Enter 保存 · Esc 取消',
  models: '↑↓ 选择 · Enter 应用 · r 刷新 · Esc 返回',
  efforts: '↑↓ 选择 · Enter 应用 · r 刷新 · Esc 返回',
  permission: '↑↓ 选择 · Enter 应用 · Esc 返回',
  sections: '↑↓ 选择 · Enter 应用 · n 新建 · Esc 返回',
  'section-new': 'Enter 保存 · Esc 取消',
  browser: '↑↓ 选择 · n 新建 · x 撤销 · Esc 返回',
  'browser-new': 'Enter 下一步 · Esc 取消',
  computer: 'Enter 开关 · r 重试 · x 撤销应用 · Esc 返回',
  'computer-level': '↑↓ 选择 · Enter 应用 · Esc 返回',
  groups: '↑↓ 选择 · Enter 打开 · n 新建 · e 设置 · x 删除 · Esc 返回',
  'group-new': '↑↓ 选择 · 空格 切换 · a 全选 · Enter 保存 · Esc 取消',
  'group-members': '↑↓ 选择 · 空格 切换 · a 全选 · Enter 保存 · Esc 取消',
  'group-edit': '↑↓ 选择 · Enter 修改 · Esc 返回',
  'room-sections': '↑↓ 选择 · Enter 应用 · n 新建 · Esc 返回',
  'room-section-new': 'Enter 保存 · Esc 取消',
  'room-permission': '↑↓ 选择 · Enter 应用 · Esc 返回',
  schedules: '↑↓ 选择 · n 新建 · x 删除 · r 刷新 · Esc 返回',
  'schedule-new': 'Enter 下一步 · Esc 取消',
  memory: '↑↓ 选择 · Enter 编辑 · a 提问 · p 置顶 · l 共享 · m 移动 · t 撤销整理 · h 历史 · x 忘记（再按一次）· r 刷新 · Esc 返回',
  'memory-ask': 'Enter 发送 · Esc 取消',
  'memory-edit': 'Enter 保存 · Ctrl+Enter 换行 · Esc 取消',
  'memory-move': '↑↓ 选择 · Enter 移动 · Esc 返回',
  'memory-history': '↑↓ 选择 · Enter 恢复 · n 更早 · r 刷新 · Esc 返回',
  avatar: '↑↓ 选择 · Enter 应用 · i 图片路径 · x 恢复默认 · Esc 返回',
  'avatar-path': 'Enter 使用 · Esc 取消',
  colors: '↑↓ 选择 · Enter 应用 · Esc 返回',
  usage: 'd 一天 · w 一周 · m 一月 · r 刷新 · Esc 返回',
  approve: '↑↓ 选择 · Enter 批准 · Esc 返回',
  capabilities: '↑↓ 选择 · Enter 挂载/卸载 · Esc 返回',
  approvals: '↑↓ 选择 · Enter 允许 · x 拒绝 · h 历史 · Esc 返回',
}

// Two modes carry state-dependent hints; everything else is a static line.
export function modeHint(mode, state = {}) {
  if (mode === 'field') {
    return state.fieldKey === 'instructions'
      ? 'Enter 换行 · Ctrl+Enter 保存 · Esc 取消'
      : MODE_HINTS.field
  }
  if (mode === 'schedule-new') {
    return state.scheduleStep === 4
      ? '1–7 切换 · Enter 保存 · Esc 取消'
      : MODE_HINTS['schedule-new']
  }
  if (mode === 'approvals' && state.approvalHistoryOpen === true) {
    return 'h 返回待审批 · Esc 返回'
  }
  return MODE_HINTS[mode] ?? '↑↓ 选择 · Enter 确认 · Esc 返回'
}

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
  const team = { bots: [], rooms: [], sections: [], pending: [], revision: undefined, mainId: undefined, error: '', foreign: undefined }

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
      // A Bot's id is the id of its FIRST own-chat Session; after a context
      // rotation the live Session is `bot.sessionId`. The roster has to know
      // both: the terminal can be parked on an earlier segment, and that
      // session still belongs to this Bot.
      segments: (Array.isArray(bot.segments) ? bot.segments : [])
        .map((segment) => segment?.sessionId)
        .filter((id) => typeof id === 'string' && id !== ''),
      main: mains.includes(bot.id),
      blocked: bot.blocked?.code,
      waiting: bot.kickoff !== undefined,
      workDir: bot.workDir ?? '',
      instructions: bot.instructions ?? '',
      private: bot.private === true,
      pinned: bot.pinned === true,
      hidden: bot.hidden === true,
      effort: bot.effort ?? '',
      permission: typeof bot.permission === 'string' ? bot.permission : undefined,
      color: bot.color ?? '',
      avatar: bot.avatar !== null && typeof bot.avatar === 'object'
        ? {
          shape: typeof bot.avatar.shape === 'string' ? bot.avatar.shape : undefined,
          image: typeof bot.avatar.image === 'string' ? bot.avatar.image : undefined,
        }
        : undefined,
      sectionId: typeof bot.sectionId === 'string' ? bot.sectionId : undefined,
      computerLevel: bot.computer !== null && typeof bot.computer === 'object' && typeof bot.computer.level === 'string'
        ? bot.computer.level
        : undefined,
      browserGrants: Array.isArray(bot.browserGrants)
        ? bot.browserGrants.map((grant) => ({
          site: typeof grant?.site === 'string' ? grant.site : '',
          kinds: Array.isArray(grant?.kinds) ? grant.kinds.filter((kind) => typeof kind === 'string') : [],
          until: typeof grant?.until === 'number' ? grant.until : undefined,
        }))
        : [],
      capabilities: Array.isArray(bot.capabilities) ? bot.capabilities : [],
    }))
    team.sections = (Array.isArray(state.sections) ? state.sections : [])
      .map((section) => ({
        id: String(section?.id ?? ''),
        name: String(section?.name ?? section?.id ?? ''),
      }))
      .filter((section) => section.id !== '')
    team.rooms = Object.values(state.rooms ?? {}).map((room) => ({
      id: room.id,
      name: room.name ?? room.id,
      members: Array.isArray(room.members) ? room.members.filter((id) => typeof id === 'string') : [],
      admin: typeof room.admin === 'string' ? room.admin : null,
      mode: room.mode === 'admin' ? 'admin' : 'everyone',
      notice: room.notice ?? '',
      permission: typeof room.permission === 'string' ? room.permission : undefined,
      workDir: room.workDir ?? '',
      sectionId: typeof room.sectionId === 'string' ? room.sectionId : undefined,
      named: room.named === true,
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

/** Session -> pid claims, as dsh-tui publishes them next to its settings. */
function readMounts() {
  try {
    const parsed = JSON.parse(readFileSync(join(homedir(), '.dsh-tui', 'session-mounts.json'), 'utf8'))
    const claims = new Map()
    for (const owner of parsed.owners ?? []) {
      const pid = Number(owner.pid)
      for (const id of owner.sessionIds ?? []) claims.set(String(id), pid)
    }
    return claims
  } catch {
    return new Map()
  }
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

function relative(at) {
  const seconds = Math.max(0, Math.round((Date.now() - Number(at ?? Date.now())) / 1000))
  if (seconds < 60) return `${seconds}s 前`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m 前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h 前`
  return `${Math.round(hours / 24)}d 前`
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

// Terminal cells, not JS characters: a CJK name or an emoji takes two cells,
// so a pad that counts code units leaves every column to its right shifted.
function charWidth(code) {
  if (code === 0x200d) return 0 // zero-width joiner
  if (code >= 0x0300 && code <= 0x036f) return 0 // combining marks
  if (code < 0x1100) return 1
  if (code <= 0x115f) return 2 // Hangul Jamo
  if (code >= 0x2e80 && code <= 0xa4cf) return 2 // CJK radicals … Yi
  if (code >= 0xac00 && code <= 0xd7a3) return 2 // Hangul syllables
  if (code >= 0xf900 && code <= 0xfaff) return 2 // CJK compatibility
  if (code >= 0xfe10 && code <= 0xfe19) return 2
  if (code >= 0xfe30 && code <= 0xfe6f) return 2
  if (code >= 0xff00 && code <= 0xff60) return 2 // fullwidth forms
  if (code >= 0xffe0 && code <= 0xffe6) return 2
  if (code >= 0x1f300 && code <= 0x1f64f) return 2 // emoji
  if (code >= 0x1f900 && code <= 0x1f9ff) return 2
  if (code >= 0x20000 && code <= 0x3fffd) return 2 // CJK extension B+
  return 1
}

function widthOf(text) {
  let width = 0
  for (const char of String(text ?? '')) width += charWidth(char.codePointAt(0))
  return width
}

function truncate(text, width) {
  const value = String(text ?? '')
  if (width <= 0) return ''
  if (widthOf(value) <= width) return value
  if (width === 1) return '…'
  let out = ''
  let used = 0
  for (const char of value) {
    const next = used + charWidth(char.codePointAt(0))
    if (next > width - 1) break
    out += char
    used = next
  }
  return `${out}…`
}

function pad(text, width) {
  const value = String(text ?? '')
  const used = widthOf(value)
  if (used >= width) return truncate(value, width)
  return value + ' '.repeat(width - used)
}

export function TeamScene(props) {
  const { React, ui, channel, close } = props
  const { Box, Text, useInput, useTerminalSize } = ui
  const h = React.createElement

  const [team, setTeam] = React.useState(readTeam)
  const [selectedId, setSelectedId] = React.useState(undefined)
  const [notice, setNotice] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [mode, setMode] = React.useState('list')
  const [draft, setDraft] = React.useState('')
  const [pendingDelete, setPendingDelete] = React.useState(undefined)
  const [pendingDeleteAt, setPendingDeleteAt] = React.useState(0)
  const [approveIndex, setApproveIndex] = React.useState(0)
  const [capIndex, setCapIndex] = React.useState(0)
  const [editIndex, setEditIndex] = React.useState(0)
  const [fieldKey, setFieldKey] = React.useState(undefined)
  const [fieldTarget, setFieldTarget] = React.useState('bot')
  const [fieldDraft, setFieldDraft] = React.useState('')
  const [modelItems, setModelItems] = React.useState([])
  const [modelIndex, setModelIndex] = React.useState(0)
  const [modelBusy, setModelBusy] = React.useState(false)
  const [groupIndex, setGroupIndex] = React.useState(0)
  const [groupEditIndex, setGroupEditIndex] = React.useState(0)
  const [groupMembers, setGroupMembers] = React.useState([])
  const [groupMemberIndex, setGroupMemberIndex] = React.useState(0)
  const [roomSectionIndex, setRoomSectionIndex] = React.useState(0)
  const [pendingDeleteRoom, setPendingDeleteRoom] = React.useState(undefined)
  const [pendingDeleteRoomAt, setPendingDeleteRoomAt] = React.useState(0)
  const [scheduleTasks, setScheduleTasks] = React.useState([])
  const [scheduleIndex, setScheduleIndex] = React.useState(0)
  const [scheduleBusy, setScheduleBusy] = React.useState(false)
  const [scheduleAvailable, setScheduleAvailable] = React.useState(true)
  const [scheduleStep, setScheduleStep] = React.useState(0)
  const [scheduleDraft, setScheduleDraft] = React.useState({ title: '', prompt: '', kind: 'daily', value: '09:00', weekdays: [] })
  const [scheduleTarget, setScheduleTarget] = React.useState(undefined)
  const [avatarIndex, setAvatarIndex] = React.useState(0)
  const [colorIndex, setColorIndex] = React.useState(0)
  const [effortItems, setEffortItems] = React.useState([])
  const [effortIndex, setEffortIndex] = React.useState(0)
  const [effortBusy, setEffortBusy] = React.useState(false)
  const [sectionIndex, setSectionIndex] = React.useState(0)
  const [permissionIndex, setPermissionIndex] = React.useState(0)
  const [roomPermissionIndex, setRoomPermissionIndex] = React.useState(0)
  const [computerIndex, setComputerIndex] = React.useState(2)
  const [computerPanel, setComputerPanel] = React.useState(undefined)
  const [computerPanelBusy, setComputerPanelBusy] = React.useState(false)
  const [computerAppIndex, setComputerAppIndex] = React.useState(0)
  const [browserIndex, setBrowserIndex] = React.useState(0)
  const [browserSite, setBrowserSite] = React.useState('')
  const [browserStep, setBrowserStep] = React.useState(0)
  const [usageItems, setUsageItems] = React.useState([])
  const [usageBusy, setUsageBusy] = React.useState(false)
  const [usageDays, setUsageDays] = React.useState(7)
  const [memoryTarget, setMemoryTarget] = React.useState(undefined)
  const [memoryPlaces, setMemoryPlaces] = React.useState([])
  const [memoryMoveIndex, setMemoryMoveIndex] = React.useState(0)
  const [memoryMoveEntry, setMemoryMoveEntry] = React.useState(undefined)
  const [search, setSearch] = React.useState('')
  const [helpAt, setHelpAt] = React.useState(0)
  const [detailOpen, setDetailOpen] = React.useState(true)
  const [memoryEntries, setMemoryEntries] = React.useState([])
  const [memoryIndex, setMemoryIndex] = React.useState(0)
  const [memoryBusy, setMemoryBusy] = React.useState(false)
  const [memoryReport, setMemoryReport] = React.useState(undefined)
  const [memorySummary, setMemorySummary] = React.useState('')
  const [memoryTidy, setMemoryTidy] = React.useState(undefined)
  const [memoryHistory, setMemoryHistory] = React.useState([])
  const [memoryHistoryMore, setMemoryHistoryMore] = React.useState(undefined)
  const [memoryHistoryAt, setMemoryHistoryAt] = React.useState(0)
  const [memoryHistoryBusy, setMemoryHistoryBusy] = React.useState(false)
  const [memoryEditEntry, setMemoryEditEntry] = React.useState(undefined)
  const [pendingForget, setPendingForget] = React.useState(undefined)
  const [pendingForgetAt, setPendingForgetAt] = React.useState(0)
  const [approvalHistoryOpen, setApprovalHistoryOpen] = React.useState(false)
  const [, rerender] = React.useReducer((n) => n + 1, 0)
  const { columns, rows } = useTerminalSize()

  React.useEffect(() => {
    // Directory watch, not a per-second poll: DS Bot swaps state.json in with a
    // rename, so the directory is the durable thing to watch (see watch.js).
    const watcher = watchTeam(() => setTeam(readTeam()), { home: join(dshHome(), 'bot') })
    return () => watcher.close()
  }, [])
  React.useEffect(() => subscribe(rerender), [])
  React.useEffect(() => subscribeApprovalHistory(rerender), [])
  React.useEffect(() => {
    // DS Bot settles approvals inside its own runtime (the TUI answer, a race
    // won by DSH's card, or a cancellation). Its `settled` event is the only
    // notice; the pending map is already empty by then, so keep the open entry
    // to name the request in the local history.
    const rt = runtime()
    if (typeof rt?.onApproval !== 'function') return
    const open = new Map()
    const off = rt.onApproval((kind, data) => {
      if (kind === 'open') {
        if (data?.id !== undefined) open.set(data.id, data)
        return
      }
      if (kind !== 'settled' || data?.id === undefined) return
      const entry = open.get(data.id) ?? {}
      open.delete(data.id)
      recordApproval({ ...entry, id: data.id, outcome: data.outcome, decidedAt: Date.now() })
    })
    return typeof off === 'function' ? off : undefined
  }, [])

  const sectionOrder = new Map(team.sections.map((section, at) => [section.id, at]))
  const teamBots = team.bots
    .map((bot) => ({
      ...bot,
      live: activityOf(bot.sessionId),
      unread: unreadOf(bot.sessionId),
    }))
    .sort((a, b) => {
      // Sidebar sections first, in the order DS Bot keeps them; ungrouped last.
      const aGrouped = a.sectionId === undefined ? 1 : 0
      const bGrouped = b.sectionId === undefined ? 1 : 0
      if (aGrouped !== bGrouped) return aGrouped - bGrouped
      if (aGrouped === 0 && a.sectionId !== b.sectionId) {
        return (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0)
      }
      const rank = (bot) => (bot.main ? 0 : bot.live?.status === 'needs-input' ? 1 : bot.live?.status === 'working' ? 2 : bot.unread > 0 ? 3 : 4)
      return rank(a) - rank(b) || a.name.localeCompare(b.name)
    })
  const needle = search.trim().toLowerCase()
  const bots = needle === ''
    ? teamBots
    : teamBots.filter((bot) => `${bot.name} ${bot.role}`.toLowerCase().includes(needle))

  const count = bots.length
  const total = teamBots.length
  const rooms = team.rooms
  const botName = (id) => teamBots.find((bot) => bot.id === id)?.name ?? String(id)
  const roomHere = rooms.find((room) => room.id === channel.sessionId)
  const markSessionSeen = (sessionId) => {
    if (sessionId === undefined || sessionId === null) return
    markSeen(sessionId)
    const owner = teamBots.find((bot) =>
      bot.sessionId === sessionId || bot.segments.includes(String(sessionId)))
    if (owner !== undefined) markSeen(owner.sessionId)
  }
  // Whatever session the terminal is on when the roster opens is read. A Bot
  // owns its current Session AND every earlier segment, so the mark has to
  // cover both: the terminal can be parked on an old segment of a Bot.
  React.useEffect(() => {
    markSessionSeen(channel.sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const working = teamBots.filter((bot) => bot.live?.status === 'working').length
  const waiting = teamBots.filter((bot) => bot.live?.status === 'needs-input').length
  const unread = teamBots.reduce((total, bot) => total + bot.unread, 0)
  // Selection is the Bot id, not the row number: live status re-ranks the
  // list every second, and an index would silently move the cursor to
  // whichever Bot slid into the old row.
  const found = selectedId === undefined ? 0 : bots.findIndex((bot) => bot.id === selectedId)
  const index = found >= 0 ? found : 0
  const current = count === 0 ? undefined : bots[index]
  const here = teamBots.find((bot) =>
    bot.id === channel.sessionId ||
    bot.sessionId === channel.sessionId ||
    bot.segments.includes(String(channel.sessionId)))
  const mounts = readMounts()
  const holderOf = (bot) => {
    for (const id of [bot.sessionId, ...bot.segments]) {
      const pid = mounts.get(String(id))
      // A crashed TUI can leave a claim behind; a stale one must not hide the
      // live holder of an earlier segment.
      if (pid !== undefined && pid !== process.pid && alive(pid)) return pid
    }
    return undefined
  }
  const heldByThisTerminal = (bot) =>
    [bot.sessionId, ...bot.segments].some((id) => mounts.get(String(id)) === process.pid)
  const foreignOf = holderOf
  const listHeight = Math.max(1, Math.min(count, rows - 11))
  const offset = Math.max(0, Math.min(index - listHeight + 1, count - listHeight))
  const helpHeight = Math.max(1, rows - 8)
  const helpMax = Math.max(0, HELP_ENTRIES.length - helpHeight)
  const helpTop = Math.min(helpAt, helpMax)

  const leave = (sessionId) => {
    markSessionSeen(sessionId ?? channel.sessionId)
    close()
  }

  const open = async (bot) => {
    if (bot === undefined || busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await channel.resumeTo(bot.sessionId)
      if (result?.ok) {
        leave(bot.sessionId)
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
    if (!rt) throw new Error('DS Bot 运行时还没就绪')
    const live = rt.live?.has?.(bot.sessionId) ?? false
    if (live) {
      await rt.sendUser({ sessionId: bot.sessionId, content: [{ type: 'text', text }] })
      return undefined
    }
    // Not mounted yet: mount it so the Bot's preset composes the agent, submit,
    // then hand the view back. A parked turn keeps running.
    const previous = channel.sessionId
    const mounted = await channel.resumeTo(bot.sessionId)
    if (!mounted?.ok) throw new Error(reason(mounted))
    channel.submit(text)
    if (previous !== undefined && previous !== bot.sessionId) {
      const back = await channel.resumeTo(previous)
      if (!back?.ok) return `已发送，但切回原会话失败：${reason(back)}`
    }
    return undefined
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
    if (!rt) throw new Error('DS Bot 运行时还没就绪')
    const [rawName, ...rest] = text.split(/[,，]/)
    const name = rawName?.trim() ?? ''
    if (name === '') throw new Error('名字不能为空')
    const role = rest[0]?.trim().slice(0, 24) ?? ''
    const brief = rest.slice(1).join(',').trim()
    const model = await pickModel(rt)
    await ensureWritable(rt)
    const created = await rt.createBot({
      name,
      role,
      ...(brief === '' ? {} : { brief }),
      ...(model === undefined ? {} : { model }),
    })
    const next = readTeam()
    setTeam(next)
    setSelectedId(created.id)
  }

  const stopBot = async (bot) => {
    const rt = runtime()
    if (typeof rt?.stopChat !== 'function') {
      setNotice('无法停止：DS Bot 运行时未就绪')
      return
    }
    if (bot.id === undefined) return
    try {
      const stopped = await rt.stopChat(bot.id)
      setNotice(stopped ? `已停止 ${bot.name}` : `${bot.name} 当前没有运行中的回合`)
    } catch (error) {
      setNotice(`停止失败：${error?.message ?? error}`)
    }
  }

  const deleteBot = async (bot) => {
    const rt = runtime()
    if (typeof rt?.deleteBot !== 'function') {
      setNotice('无法删除：DS Bot 运行时未就绪')
      return
    }
    if (bot.main) {
      setNotice('Main Bot 不能删除。')
      setPendingDelete(undefined)
      return
    }
    try {
      await ensureWritable(rt)
      await rt.deleteBot(bot.id)
      setNotice(`已删除 ${bot.name}`)
      setPendingDelete(undefined)
      setSelectedId(undefined)
      setTeam(readTeam())
    } catch (error) {
      setNotice(`删除失败：${error?.message ?? error}`)
      setPendingDelete(undefined)
    }
  }

  const ensureWritable = async (rt) => {
    if (!rt) throw new Error('DS Bot 运行时还没就绪')
    await rt.load?.()
    await rt.refresh?.()
    if (typeof rt.readOnly === 'function' && rt.readOnly() !== undefined) {
      throw new Error(rt.readOnly())
    }
  }

  const approve = async (capability) => {
    if (busy || capability === undefined) return
    const rt = runtime()
    if (typeof rt?.capabilityEndpoint !== 'function') {
      setNotice('无法授权：DS Bot 运行时未就绪')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await ensureWritable(rt)
      await rt.capabilityEndpoint('capability-approve', { name: capability.name })
      // The runtime reconciles its live agents on save (`capabilitiesStateSaved`),
      // so an already-open Bot picks the tools up without an extra mount here.
      // Mounting explicitly would resume every offline Bot that has the
      // capability attached and spawn its MCP servers for nothing.
      const next = readTeam()
      setTeam(next)
      setMode('list')
      const bound = next.bots.filter((bot) => bot.capabilities.includes(capability.name)).length
      setNotice(bound === 0
        ? `已授权 ${capability.name}，但没有 Bot 绑定它；按 v 给某个 Bot 挂载。`
        : `已授权 ${capability.name}，已绑定的 Bot 下次对话就会挂载。`)
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
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪，稍后再试')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await ensureWritable(rt)
      await rt.syncModels?.()
      const model = await pickModel(rt)
      const created = await rt.createBot({
        name: rt.defaults?.mainName ?? 'Chief',
        role: rt.defaults?.mainRole ?? 'Chief of Staff',
        main: true,
        color: 'deepseek',
        avatar: { shape: 'whale' },
        ...(model === undefined ? {} : { model }),
      })
      setSelectedId(created.id)
      setTeam(readTeam())
      setNotice('已创建 Chief。')
    } catch (error) {
      setNotice(`创建失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  // Capabilities this Bot can mount or drop. The browser's per-Bot card lists
  // every saved item (MCP, skill, pack); the roster needs the same seam or
  // "approved" silently means "approved for whoever already had it". A stdio
  // MCP joins only after `p` approves it; HTTP MCPs are approved on save.
  const capabilityList = () => {
    if (current === undefined) return []
    const rt = runtime()
    if (typeof rt?.capabilityLibraryView !== 'function') return []
    try {
      return rt.capabilityLibraryView()
        .filter((item) => item?.kind === 'mcp'
          ? item.approved === true
          : item?.kind === 'pack' || item?.kind === 'skill')
        .map((item) => ({ ...item, attached: current.capabilities.includes(item.name) }))
    } catch {
      return []
    }
  }

  const toggleCapability = async (item) => {
    if (busy || current === undefined || item === undefined) return
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      await ensureWritable(rt)
      await rt.capabilityEndpoint('bot-capability', {
        botId: current.id,
        name: item.name,
        attached: !item.attached,
      })
      if (!item.attached) {
        // Reconcile the agents this process already has. Resolving the Bot's
        // session instead would mount its MCP servers even when no chat is
        // open; the next real turn mounts them anyway.
        try {
          if (typeof rt.scheduleCapabilitiesReconcile === 'function') {
            await rt.scheduleCapabilitiesReconcile()
          } else {
            await rt.ensureCapabilities?.(current.sessionId)
          }
        } catch {
          // Surfaced through `capabilityNote` on the next render.
        }
      }
      setTeam(readTeam())
      setNotice(`${item.name} ${item.attached ? '已卸载' : '已挂载'}。`)
    } catch (error) {
      setNotice(`操作失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const submitDraft = async () => {
    const text = draft.trim()
    if (text === '') return
    if (mode === 'message' && current === undefined) {
      setNotice('没有选中的 Bot。')
      return
    }
    setBusy(true)
    setNotice('')
    try {
      if (mode === 'message') {
        const warning = await send(current, text)
        setNotice(warning ?? `已发给 ${current.name}；它开工时列表会亮起来。`)
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

  // ── Bot settings ──────────────────────────────────────────────────────────
  // The browser's Bot settings page, as a keyboard form. Each text row opens a
  // one-field editor; switches apply at once; the model row opens the catalog.
  const sectionName = (id) => (id === undefined ? '无' : team.sections.find((section) => section.id === id)?.name ?? '无')
  const permissionCatalog = () => {
    const rt = runtime()
    try {
      return rt?.permissionCatalog?.() ?? null
    } catch {
      return null
    }
  }
  const permissionOptions = () => {
    const options = permissionCatalog()?.options
    return Array.isArray(options) ? options : []
  }
  const permissionName = (value) => {
    if (value === undefined) return '各自'
    const found = permissionOptions().find((option) => option?.value === value)
    return found?.name ?? String(value)
  }
  const botPermissionValue = (bot) => {
    const saved = bot.permission ?? permissionCatalog()?.defaultPreset
    return saved === undefined ? '默认' : permissionName(saved)
  }
  const editFields = (bot) => [
    { key: 'name', label: 'Name', value: bot.name },
    { key: 'role', label: 'Label', value: bot.role || '' },
    { key: 'instructions', label: 'Instructions', value: bot.instructions || '' },
    { key: 'model', label: 'Model', value: bot.model || '默认' },
    { key: 'workDir', label: 'Folder', value: bot.workDir || '团队工作区' },
    { key: 'private', label: 'Private', value: bot.private ? 'on' : 'off' },
    { key: 'pinned', label: 'Pinned', value: bot.pinned ? 'on' : 'off' },
    { key: 'hidden', label: 'Hidden', value: bot.hidden ? 'on' : 'off' },
    { key: 'main', label: 'Main Bot', value: bot.main ? 'on' : 'off' },
    {
      key: 'avatar',
      label: 'Avatar',
      value: bot.avatar?.image ? '自定义图片' : (bot.avatar?.shape ?? 'whale'),
    },
    { key: 'color', label: 'Color', value: bot.color || 'deepseek' },
    { key: 'effort', label: 'Effort', value: bot.effort || '默认' },
    {
      key: 'permission',
      label: 'Permission',
      value: botPermissionValue(bot),
    },
    { key: 'section', label: 'Section', value: sectionName(bot.sectionId) },
    { key: 'computer', label: 'Computer', value: bot.computerLevel || '后台' },
    { key: 'browser', label: 'Browser', value: bot.browserGrants.length === 0 ? '无' : `${bot.browserGrants.length} 条` },
    { key: 'memory', label: 'Memory', value: '查看' },
    { key: 'schedules', label: 'Schedules', value: '查看' },
    { key: 'duplicate', label: 'Duplicate', value: '复制' },
    { key: 'delete', label: 'Delete', value: '', danger: true },
  ]
  const editAt = Math.min(editIndex, 19)
  const editField = current === undefined ? undefined : editFields(current)[editAt]

  const openModels = async () => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    const target = current
    setMode('models')
    setModelBusy(true)
    setModelItems([])
    setModelIndex(0)
    try {
      const cached = typeof rt.cachedCatalog === 'function' ? rt.cachedCatalog() : undefined
      const items = Array.isArray(cached) && cached.length > 0 ? cached : await rt.catalog()
      setModelItems(items)
      const at = items.findIndex((item) => item.ref === target.model)
      setModelIndex(at >= 0 ? at : 0)
    } catch (error) {
      setNotice(`读取模型失败：${error?.message ?? error}`)
    } finally {
      setModelBusy(false)
    }
  }

  const applyModel = async (item) => {
    if (current === undefined || item === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { model: item.ref })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(3)
      setNotice(`模型已设为 ${item.ref}（下一条消息生效）。`)
    } catch (error) {
      setNotice(`切换模型失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const avatarMime = (path) => {
    const ext = path.toLowerCase().split('.').pop()
    if (ext === 'png') return 'image/png'
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
    if (ext === 'webp') return 'image/webp'
    if (ext === 'gif') return 'image/gif'
    if (ext === 'svg') return 'image/svg+xml'
    return undefined
  }

  const applyAvatar = async (shape) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { avatar: { shape } })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(9)
      setNotice(`头像已设为 ${shape}。`)
    } catch (error) {
      setNotice(`设置头像失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const clearAvatar = async () => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { avatar: null })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(9)
      setNotice('已恢复默认头像。')
    } catch (error) {
      setNotice(`恢复头像失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const submitAvatarPath = async (valueOverride) => {
    const path = String(valueOverride ?? fieldDraft).trim()
    if (path === '') {
      setNotice('输入图片路径')
      return
    }
    const mime = avatarMime(path)
    if (mime === undefined) {
      setNotice('只支持 PNG / JPEG / WebP / GIF / SVG')
      return
    }
    const rt = runtime()
    if (!rt || current === undefined) return
    setBusy(true)
    try {
      const bytes = readFileSync(path)
      if (bytes.byteLength > 160 * 1024) throw new Error('图片太大（超过 160KB）')
      const image = `data:${mime};base64,${bytes.toString('base64')}`
      await ensureWritable(rt)
      await rt.updateBot(current.id, { avatar: { image } })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(9)
      setFieldDraft('')
      setNotice('头像已更新。')
    } catch (error) {
      setNotice(`设置头像失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applyColor = async (color) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { color })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(10)
      setNotice(`颜色已设为 ${color}。`)
    } catch (error) {
      setNotice(`设置颜色失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const openEfforts = async () => {
    const rt = runtime()
    if (!rt || current === undefined) return
    if (typeof rt.reasoningOf !== 'function') {
      setNotice('当前后端不支持思考级别')
      return
    }
    setMode('efforts')
    setEffortBusy(true)
    setEffortItems([])
    setEffortIndex(0)
    setNotice('')
    try {
      const info = await rt.reasoningOf(current.model)
      const items = Array.isArray(info?.efforts) ? info.efforts : []
      setEffortItems(items)
      const at = items.findIndex((item) => item.id === current.effort)
      setEffortIndex(at >= 0 ? at : 0)
    } catch (error) {
      setNotice(`读取思考级别失败：${error?.message ?? error}`)
    } finally {
      setEffortBusy(false)
    }
  }

  const applyEffort = async (item) => {
    if (current === undefined || item === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { effort: item.id })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(11)
      setNotice(`思考级别已设为 ${item.name || item.id}。`)
    } catch (error) {
      setNotice(`切换思考级别失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applyBotPermission = async (value) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { permission: value })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(12)
      setNotice(`权限已设为 ${permissionName(value)}。`)
    } catch (error) {
      setNotice(`切换权限失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applySection = async (sectionId) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { sectionId })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(13)
      setNotice(sectionId === null ? '已移出分组。' : `已移到分组 ${sectionName(sectionId)}。`)
    } catch (error) {
      setNotice(`移动分组失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const createSection = async (name) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { section: name })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(13)
      setFieldDraft('')
      setNotice(`已移到新分组 ${name}。`)
    } catch (error) {
      setNotice(`新建分组失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applyComputerLevel = async (level) => {
    const rt = runtime()
    if (!rt || current === undefined) return
    if (typeof rt.computerEndpoint !== 'function') {
      setNotice('当前后端不支持 Computer 授权')
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.computerEndpoint('set-level', { botId: current.id, level })
      setTeam(readTeam())
      setMode('edit')
      setEditIndex(14)
      setNotice(`Computer 权限：${COMPUTER_LEVELS.find((item) => item.id === level)?.name ?? level}`)
    } catch (error) {
      setNotice(`设置 Computer 权限失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const computerLevelName = (id) => COMPUTER_LEVELS.find((item) => item.id === id)?.name ?? id
  const computerApps = () => {
    const bots = computerPanel?.bots ?? {}
    const rows = []
    for (const bot of teamBots) {
      const info = bots[bot.id]
      const apps = Object.keys(info?.apps ?? {})
      rows.push({ bot, level: info?.level ?? 'background', apps })
    }
    return rows
  }
  const refreshComputer = () => {
    const rt = runtime()
    if (typeof rt?.computerView === 'function') setComputerPanel(rt.computerView())
  }
  const openComputer = async () => {
    const rt = runtime()
    if (!rt || typeof rt.computerView !== 'function') {
      setNotice('当前后端不支持 Computer')
      return
    }
    setMode('computer')
    setComputerPanelBusy(true)
    setComputerAppIndex(0)
    setNotice('')
    try {
      setComputerPanel(rt.computerView())
    } catch (error) {
      setNotice(`读取 Computer 状态失败：${error?.message ?? error}`)
    } finally {
      setComputerPanelBusy(false)
    }
  }
  const toggleComputer = async () => {
    const rt = runtime()
    if (!rt || typeof rt.computerEndpoint !== 'function') return
    const next = computerPanel?.enabled !== true
    setComputerPanelBusy(true)
    try {
      await rt.computerEndpoint('set-enabled', { enabled: next })
      refreshComputer()
      setNotice(next ? 'Computer 已启用。' : 'Computer 已关闭。')
    } catch (error) {
      setNotice(`切换 Computer 失败：${error?.message ?? error}`)
    } finally {
      setComputerPanelBusy(false)
    }
  }
  const retryComputer = async () => {
    const rt = runtime()
    if (!rt || typeof rt.computerEndpoint !== 'function') return
    setComputerPanelBusy(true)
    try {
      await rt.computerEndpoint('provider-retry')
      refreshComputer()
      setNotice('已重试 Computer 提供方。')
    } catch (error) {
      setNotice(`重试失败：${error?.message ?? error}`)
    } finally {
      setComputerPanelBusy(false)
    }
  }
  const revokeComputerApp = async (app) => {
    if (app === undefined) return
    const rt = runtime()
    if (!rt || typeof rt.computerEndpoint !== 'function') return
    setComputerPanelBusy(true)
    try {
      await rt.computerEndpoint('revoke-app', { botId: app.bot.id, appKey: app.appKey })
      refreshComputer()
      setNotice(`已撤销 ${app.bot.name} 对 ${app.appKey} 的授权。`)
    } catch (error) {
      setNotice(`撤销失败：${error?.message ?? error}`)
    } finally {
      setComputerPanelBusy(false)
    }
  }

  const saveBrowserGrants = async (grants, message) => {
    if (current === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { browserGrants: grants })
      setTeam(readTeam())
      setMode('browser')
      setBrowserStep(0)
      setBrowserSite('')
      setFieldDraft('')
      setNotice(message)
    } catch (error) {
      setNotice(`保存浏览器授权失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const submitBrowserGrant = async (valueOverride) => {
    const site = browserSite.trim().toLowerCase()
    const kinds = [...new Set(String(valueOverride ?? fieldDraft)
      .split(/[,\s]+/)
      .map((kind) => kind.trim().toLowerCase())
      .filter((kind) => kind !== ''))]
    if (site === '') {
      setNotice('输入站点')
      return
    }
    if (kinds.length === 0) {
      setNotice('输入权限，例如 post,upload')
      return
    }
    if (kinds.some((kind) => !BROWSER_KINDS.includes(kind))) {
      setNotice(`权限只能是 ${BROWSER_KINDS.join(', ')}`)
      return
    }
    const grants = current.browserGrants ?? []
    if (grants.some((grant) => grant.site === site && grant.kinds.join(',') === kinds.sort().join(','))) {
      setNotice('这个授权已经存在')
      return
    }
    await saveBrowserGrants([...grants, { site, kinds: kinds.sort() }], `已授权 ${site}：${kinds.join(',')}`)
  }

  const removeBrowserGrant = async (at) => {
    if (current === undefined) return
    const grants = current.browserGrants ?? []
    const grant = grants[at]
    if (grant === undefined) return
    await saveBrowserGrants(grants.filter((_item, index) => index !== at), `已撤销 ${grant.site} 的授权`)
  }

  const openUsage = async (days = usageDays) => {
    const rt = runtime()
    if (!rt || typeof rt.usageView !== 'function' || current === undefined) {
      setNotice('当前后端不支持用量统计')
      return
    }
    setMode('usage')
    setUsageBusy(true)
    setUsageItems([])
    setNotice('')
    try {
      const view = await rt.usageView({ timeZone: localZone() })
      const owners = Array.isArray(view?.owners) ? view.owners : []
      const cutoff = new Date(Date.now() - Math.max(1, days - 1) * 86400000)
      const since = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`
      const totals = owners.map((owner, at) => ({
        key: owner.key ?? String(at),
        name: owner.name || owner.key || String(at),
        kind: owner.kind ?? '',
        id: owner.id,
        calls: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        output: 0,
      }))
      for (const row of Array.isArray(view?.rows) ? view.rows : []) {
        const bucket = totals[Number(row[1])]
        if (bucket === undefined) continue
        if (typeof row[0] === 'string' && row[0].slice(0, 10) < since) continue
        bucket.input += Number(row[4] ?? 0)
        bucket.cacheRead += Number(row[5] ?? 0)
        bucket.cacheWrite += Number(row[6] ?? 0)
        bucket.output += Number(row[7] ?? 0)
        bucket.calls += Number(row[8] ?? 0)
      }
      setUsageItems(totals
        .filter((item) => item.calls > 0 || item.input + item.output + item.cacheRead + item.cacheWrite > 0)
        .sort((a, b) => (b.input + b.output + b.cacheRead + b.cacheWrite) - (a.input + a.output + a.cacheRead + a.cacheWrite)))
    } catch (error) {
      setNotice(`读取用量失败：${error?.message ?? error}`)
    } finally {
      setUsageBusy(false)
    }
  }

  const runEdit = async (field) => {
    if (current === undefined || field === undefined || busy) return
    if (field.key === 'model') {
      void openModels()
      return
    }
    if (field.key === 'avatar') {
      setAvatarIndex(Math.max(0, AVATAR_SHAPES.indexOf(current.avatar?.shape ?? 'whale')))
      setMode('avatar')
      setNotice('')
      return
    }
    if (field.key === 'color') {
      setColorIndex(Math.max(0, BOT_COLORS.indexOf(current.color || 'deepseek')))
      setMode('colors')
      setNotice('')
      return
    }
    if (field.key === 'effort') {
      void openEfforts()
      return
    }
    if (field.key === 'permission') {
      const options = permissionOptions()
      if (options.length === 0) {
        setNotice('当前 DSH 没有提供权限预设')
        return
      }
      const saved = current.permission ?? permissionCatalog()?.defaultPreset
      const at = Math.max(0, options.findIndex((option) => option.value === saved))
      setPermissionIndex(at)
      setMode('permission')
      setNotice('')
      return
    }
    if (field.key === 'section') {
      const at = current.sectionId === undefined ? -1 : team.sections.findIndex((section) => section.id === current.sectionId)
      setSectionIndex(at >= 0 ? at + 1 : 0)
      setMode('sections')
      setNotice('')
      return
    }
    if (field.key === 'computer') {
      const at = COMPUTER_LEVELS.findIndex((item) => item.id === (current.computerLevel || 'background'))
      setComputerIndex(at >= 0 ? at : 2)
      setMode('computer-level')
      setNotice('')
      return
    }
    if (field.key === 'browser') {
      setBrowserIndex(0)
      setMode('browser')
      setNotice('')
      return
    }
    if (field.key === 'memory') {
      void openMemory()
      return
    }
    if (field.key === 'schedules') {
      void openSchedules()
      return
    }
    if (field.key === 'name' || field.key === 'role' || field.key === 'instructions' || field.key === 'workDir') {
      setFieldTarget('bot')
      setFieldKey(field.key)
      // Short fields start empty so typing replaces; instructions keep the old
      // text because appending a line is the common edit.
      setFieldDraft(field.key === 'instructions' ? (field.value ?? '') : '')
      setMode('field')
      setNotice('')
      return
    }
    if (field.key === 'duplicate') {
      const rt = runtime()
      if (!rt) return
      setBusy(true)
      try {
        await ensureWritable(rt)
        const copy = await rt.duplicateBot(current.id)
        const next = readTeam()
        setTeam(next)
        setSelectedId(copy.id)
        setEditIndex(0)
        setNotice(`已复制为 ${copy.name}。`)
      } catch (error) {
        setNotice(`复制失败：${error?.message ?? error}`)
      } finally {
        setBusy(false)
      }
      return
    }
    if (field.key === 'delete') {
      if (current.main) {
        setNotice('Main Bot 不能删除。')
        return
      }
      if (pendingDelete === current.id && Date.now() - pendingDeleteAt < 5000) {
        const rt = runtime()
        if (!rt) return
        setBusy(true)
        try {
          await rt.deleteBot(current.id)
          setPendingDelete(undefined)
          setSelectedId(undefined)
          setTeam(readTeam())
          setMode('list')
          setNotice(`已删除 ${current.name}。`)
        } catch (error) {
          setNotice(`删除失败：${error?.message ?? error}`)
        } finally {
          setBusy(false)
        }
      } else {
        setPendingDelete(current.id)
        setPendingDeleteAt(Date.now())
        setNotice(`再按一次删除 ${current.name}（不可恢复）`)
      }
      return
    }
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      if (field.key === 'private') {
        await rt.updateBot(current.id, { private: !current.private })
        setNotice(current.private ? '已设为公开。' : '已设为私密。')
      } else if (field.key === 'pinned' || field.key === 'hidden') {
        await rt.setFlags(current.id, { [field.key]: !current[field.key] })
        setNotice(current[field.key] ? `已取消${field.label}。` : `已${field.label}。`)
      } else if (field.key === 'main') {
        await rt.setMain(current.id, !current.main)
        setNotice(current.main ? '已取消 Main Bot。' : '已设为 Main Bot。')
      }
      setTeam(readTeam())
    } catch (error) {
      setNotice(`操作失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  const currentRoom = rooms.length === 0 ? undefined : rooms[Math.min(groupIndex, rooms.length - 1)]
  const roomFields = (room) => [
    { key: 'name', label: 'Name', value: room.name },
    { key: 'members', label: 'Members', value: `${room.members.length} 位` },
    { key: 'admin', label: 'Admin', value: room.admin === null ? '无' : botName(room.admin) },
    { key: 'mode', label: 'Reply mode', value: room.mode === 'admin' ? '仅管理员' : '所有人' },
    { key: 'permission', label: 'Permission', value: permissionName(room.permission) },
    { key: 'workDir', label: 'Folder', value: room.workDir || '团队工作区' },
    { key: 'section', label: 'Section', value: sectionName(room.sectionId) },
    { key: 'notice', label: 'Notice', value: room.notice || '' },
    { key: 'memory', label: 'Memory', value: '查看' },
    { key: 'schedules', label: 'Schedules', value: '查看' },
    { key: 'delete', label: 'Delete', value: '', danger: true },
  ]
  const groupEditAt = Math.min(groupEditIndex, 10)
  const groupEditField = currentRoom === undefined ? undefined : roomFields(currentRoom)[groupEditAt]

  const openRoom = async (room) => {
    if (room === undefined || busy) return
    setBusy(true)
    setNotice('')
    try {
      const result = await channel.resumeTo(room.id)
      if (result?.ok) {
        markSeen(room.id)
        close()
        return
      }
      setNotice(reason(result))
    } catch (error) {
      setNotice(`打开群聊失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const createGroup = async () => {
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    if (groupMembers.length < 2) {
      setNotice('群聊至少需要两个 Bot。')
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      const room = await rt.createRoom({ members: groupMembers })
      const next = readTeam()
      setTeam(next)
      const at = next.rooms.findIndex((item) => item.id === room.id)
      setGroupIndex(at >= 0 ? at : 0)
      setMode('groups')
      setNotice(`已创建群聊 ${room.name}。`)
    } catch (error) {
      setNotice(`创建群聊失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const saveRoomMembers = async () => {
    const rt = runtime()
    if (!rt || currentRoom === undefined) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateRoom(currentRoom.id, { members: groupMembers })
      setTeam(readTeam())
      setMode('group-edit')
      setNotice('成员已更新。')
    } catch (error) {
      setNotice(`更新成员失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const deleteRoom = async (room) => {
    if (room === undefined) return
    if (pendingDeleteRoom === room.id && Date.now() - pendingDeleteRoomAt < 5000) {
      const rt = runtime()
      if (!rt) return
      setBusy(true)
      try {
        await rt.deleteRoom(room.id)
        setPendingDeleteRoom(undefined)
        setTeam(readTeam())
        setMode('groups')
        setNotice(`已删除群聊 ${room.name}。`)
      } catch (error) {
        setNotice(`删除群聊失败：${error?.message ?? error}`)
      } finally {
        setBusy(false)
      }
    } else {
      setPendingDeleteRoom(room.id)
      setPendingDeleteRoomAt(Date.now())
      setNotice(`再按一次删除群聊 ${room.name}（不可恢复）`)
    }
  }

  const saveField = async () => {
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    const value = fieldDraft.trim()
    const savedLabel = fieldKey === 'role' ? 'Label'
      : fieldKey === 'instructions' ? 'Instructions'
      : fieldKey === 'workDir' ? 'Folder'
      : fieldKey === 'notice' ? 'Notice'
      : 'Name'
    if (fieldTarget === 'room') {
      if (currentRoom === undefined) {
        setMode('groups')
        return
      }
      if (fieldKey === 'name' && value === '') {
        setNotice('群聊名称不能为空')
        return
      }
      setBusy(true)
      try {
        await ensureWritable(rt)
        await rt.updateRoom(currentRoom.id, { [fieldKey]: value })
        setTeam(readTeam())
        setMode('group-edit')
        setNotice(`已保存 ${savedLabel}`)
      } catch (error) {
        setNotice(`保存失败：${error?.message ?? error}`)
      } finally {
        setBusy(false)
      }
      return
    }
    if (current === undefined) {
      setMode('list')
      return
    }
    if (fieldKey === 'name' && value === '') {
      setNotice('名字不能为空')
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateBot(current.id, { [fieldKey]: value })
      setTeam(readTeam())
      setMode('edit')
      setNotice(`已保存 ${savedLabel}`)
    } catch (error) {
      setNotice(`保存失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const runGroupEdit = async (field) => {
    if (currentRoom === undefined || field === undefined || busy) return
    if (field.key === 'name' || field.key === 'workDir' || field.key === 'notice') {
      setFieldTarget('room')
      setFieldKey(field.key)
      setFieldDraft('')
      setMode('field')
      setNotice('')
      return
    }
    if (field.key === 'members') {
      setGroupMembers([...currentRoom.members])
      setGroupMemberIndex(0)
      setMode('group-members')
      setNotice('')
      return
    }
    if (field.key === 'delete') {
      void deleteRoom(currentRoom)
      return
    }
    if (field.key === 'memory') {
      void openMemory({ roomId: currentRoom.id })
      return
    }
    if (field.key === 'schedules') {
      void openSchedules({ id: currentRoom.id, name: currentRoom.name })
      return
    }
    if (field.key === 'section') {
      const at = currentRoom.sectionId === undefined ? -1 : team.sections.findIndex((section) => section.id === currentRoom.sectionId)
      setRoomSectionIndex(at >= 0 ? at + 1 : 0)
      setMode('room-sections')
      setNotice('')
      return
    }
    if (field.key === 'permission') {
      if (permissionOptions().length === 0) {
        setNotice('当前 DSH 没有提供权限预设')
        return
      }
      const found = currentRoom.permission === undefined
        ? -1
        : permissionOptions().findIndex((option) => option.value === currentRoom.permission)
      setRoomPermissionIndex(found >= 0 ? found + 1 : 0)
      setMode('room-permission')
      setNotice('')
      return
    }
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      if (field.key === 'admin') {
        const options = [null, ...currentRoom.members]
        const at = options.findIndex((id) => id === currentRoom.admin)
        const next = options[(at + 1) % options.length]
        await rt.updateRoom(currentRoom.id, { admin: next })
        setNotice(next === null ? '已取消管理员。' : `管理员已设为 ${botName(next)}。`)
      } else if (field.key === 'mode') {
        const next = currentRoom.mode === 'admin' ? 'everyone' : 'admin'
        await rt.updateRoom(currentRoom.id, { mode: next })
        setNotice(next === 'admin' ? '回复模式：仅管理员。' : '回复模式：所有人。')
      }
      setTeam(readTeam())
    } catch (error) {
      setNotice(`更新群聊失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applyRoomPermission = async (permission) => {
    if (currentRoom === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateRoom(currentRoom.id, { permission })
      setTeam(readTeam())
      setMode('group-edit')
      setGroupEditIndex(4)
      setNotice(permission === null ? '群聊权限：各成员用自己的。' : `群聊权限：${permissionName(permission)}。`)
    } catch (error) {
      setNotice(`设置群聊权限失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const applyRoomSection = async (sectionId) => {
    if (currentRoom === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateRoom(currentRoom.id, { sectionId })
      setTeam(readTeam())
      setMode('group-edit')
      setGroupEditIndex(6)
      setNotice(sectionId === null ? '已移出分组。' : `已移到分组 ${sectionName(sectionId)}。`)
    } catch (error) {
      setNotice(`移动分组失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const createRoomSection = async (name) => {
    if (currentRoom === undefined) return
    const rt = runtime()
    if (!rt) return
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.updateRoom(currentRoom.id, { section: name })
      setTeam(readTeam())
      setMode('group-edit')
      setGroupEditIndex(6)
      setFieldDraft('')
      setNotice(`已移到新分组 ${name}。`)
    } catch (error) {
      setNotice(`新建分组失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Approvals ─────────────────────────────────────────────────────────────
  const approvals = (() => {
    const rt = runtime()
    if (typeof rt?.approvalsView !== 'function') return []
    try {
      return rt.approvalsView()
    } catch {
      return []
    }
  })()

  const answerApproval = (entry, choice) => {
    const rt = runtime()
    if (!rt || entry === undefined) return
    if (typeof rt.answerApproval !== 'function') {
      setNotice('当前后端不支持审批。')
      return
    }
    try {
      rt.answerApproval(entry.id, choice)
      // Without DS Bot's `settled` event (older runtime, or a runtime that does
      // not expose it) this terminal still knows what it just decided.
      if (typeof rt.onApproval !== 'function') {
        recordApproval({
          id: entry.id,
          sessionId: entry.sessionId,
          botId: entry.botId,
          roomId: entry.roomId,
          tool: entry.tool,
          reason: entry.reason,
          at: entry.at,
          outcome: choice === 'allow' ? 'allowed-once' : 'rejected',
          decidedAt: Date.now(),
        })
      }
      rerender()
      setNotice(choice === 'allow' ? `已允许 ${entry.tool || '请求'}` : `已拒绝 ${entry.tool || '请求'}`)
    } catch (error) {
      setNotice(`审批失败：${error?.message ?? error}`)
    }
  }

  const localZone = () => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
      return 'UTC'
    }
  }
  const mySchedules = () => scheduleTasks.filter((task) =>
    task.botId === scheduleTarget?.id || task.roomId === scheduleTarget?.id)

  const openSchedules = async (target) => {
    const rt = runtime()
    if (!rt) {
      setNotice('DS Bot 运行时还没就绪')
      return
    }
    const scope = target ?? (current === undefined ? undefined : { id: current.id, name: current.name })
    if (scope === undefined) return
    setScheduleTarget(scope)
    setMode('schedules')
    setScheduleBusy(true)
    setScheduleIndex(0)
    setNotice('')
    try {
      if (typeof rt.scheduleEndpoint !== 'function') {
        setScheduleAvailable(false)
        setScheduleTasks([])
        return
      }
      const view = await rt.scheduleEndpoint('schedules')
      setScheduleAvailable(view?.available !== false)
      setScheduleTasks(Array.isArray(view?.tasks) ? view.tasks : [])
    } catch (error) {
      setNotice(`读取定时任务失败：${error?.message ?? error}`)
    } finally {
      setScheduleBusy(false)
    }
  }

  const deleteSchedule = async (task) => {
    if (task === undefined) return
    const key = `schedule:${task.id}`
    if (pendingDelete === key && Date.now() - pendingDeleteAt < 5000) {
      const rt = runtime()
      if (!rt) return
      setBusy(true)
      try {
        await rt.scheduleEndpoint('schedule-delete', { id: task.id, sessionId: task.sessionId })
        setPendingDelete(undefined)
        await openSchedules(scheduleTarget)
        setNotice(`已删除定时任务 ${task.title}。`)
      } catch (error) {
        setNotice(`删除失败：${error?.message ?? error}`)
      } finally {
        setBusy(false)
      }
    } else {
      setPendingDelete(key)
      setPendingDeleteAt(Date.now())
      setNotice(`再按一次 x 删除 ${task.title}`)
    }
  }

  const submitSchedule = async (valueOverride) => {
    const rt = runtime()
    if (!rt || scheduleTarget === undefined) return
    const title = scheduleDraft.title.trim()
    const prompt = scheduleDraft.prompt.trim()
    const value = String(valueOverride ?? scheduleDraft.value).trim()
    if (title === '') {
      setNotice('给任务起个名字')
      return
    }
    if (prompt === '') {
      setNotice('写下要 Bot 做的事')
      return
    }
    let when
    try {
      if (scheduleDraft.kind === 'daily') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('时间格式 HH:MM')
        when = { kind: 'daily', time: `${value}:00`, timeZone: localZone() }
      } else if (scheduleDraft.kind === 'weekly') {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('时间格式 HH:MM')
        const weekdays = [...new Set(scheduleDraft.weekdays)].sort()
        if (weekdays.length === 0) throw new Error('至少选一个星期')
        when = { kind: 'weekly', time: `${value}:00`, weekdays, timeZone: localZone() }
      } else if (scheduleDraft.kind === 'every') {
        const minutes = Number(value)
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 7 * 24 * 60) throw new Error('间隔 1 分钟到 7 天')
        when = { kind: 'every', minutes }
      } else {
        const at = new Date(value)
        if (Number.isNaN(at.getTime())) throw new Error('时间格式 YYYY-MM-DDTHH:MM')
        if (at.getTime() <= Date.now()) throw new Error('选择将来的时间')
        when = { kind: 'at', at: at.toISOString() }
      }
    } catch (error) {
      setNotice(error?.message ?? error)
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      await rt.scheduleEndpoint('schedule-create', { target: scheduleTarget.id, title, prompt, when })
      setMode('schedules')
      await openSchedules(scheduleTarget)
      setNotice(`已创建定时任务 ${title}。`)
    } catch (error) {
      setNotice(`创建失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const openMemory = async (target) => {
    const rt = runtime()
    if (!rt || typeof rt.memoryEndpoint !== 'function') {
      setNotice('当前后端不支持记忆面板')
      return
    }
    const scope = target ?? (current === undefined ? undefined : { botId: current.id })
    if (scope === undefined) return
    setMemoryTarget(scope)
    setMode('memory')
    setMemoryBusy(true)
    setMemoryEntries([])
    setMemoryIndex(0)
    setNotice('')
    try {
      const view = await rt.memoryEndpoint('memory-view', scope)
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
    } catch (error) {
      setNotice(`读取记忆失败：${error?.message ?? error}`)
    } finally {
      setMemoryBusy(false)
    }
  }

  const askMemory = async (valueOverride) => {
    const text = String(valueOverride ?? fieldDraft).trim()
    if (text === '') return
    const rt = runtime()
    if (!rt || memoryTarget === undefined) return
    setBusy(true)
    try {
      const view = await rt.memoryEndpoint('memory-ask', { ...memoryTarget, text })
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setMemoryReport({
        reply: String(view?.reply ?? ''),
        changes: Array.isArray(view?.changes) ? view.changes : [],
      })
      setFieldDraft('')
      setMode('memory')
      setNotice('记忆已更新。')
    } catch (error) {
      setNotice(`提问失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const pinMemory = async (entry) => {
    if (entry === undefined) return
    const rt = runtime()
    if (!rt || memoryTarget === undefined) return
    setBusy(true)
    try {
      const view = await rt.memoryEndpoint('memory-pin', {
        ...memoryTarget,
        scope: entry.scope,
        topic: entry.topic,
        text: entry.text,
        pin: entry.pinned !== true,
      })
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setNotice(entry.pinned === true ? '已取消置顶。' : '已置顶该条记忆。')
    } catch (error) {
      setNotice(`置顶失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const forgetMemory = async (entry) => {
    if (entry === undefined) return
    if (pendingForget === entry.id && Date.now() - pendingForgetAt < 5000) {
      const rt = runtime()
      if (!rt || memoryTarget === undefined) return
      setBusy(true)
      try {
        await rt.memoryEndpoint('memory-forget', {
          ...memoryTarget,
          scope: entry.scope,
          topic: entry.topic,
          text: entry.text,
        })
        setPendingForget(undefined)
        await openMemory(memoryTarget)
        setNotice('已忘记该条。')
      } catch (error) {
        setNotice(`忘记失败：${error?.message ?? error}`)
      } finally {
        setBusy(false)
      }
    } else {
      setPendingForget(entry.id)
      setPendingForgetAt(Date.now())
      setNotice('再按一次 x 忘记这条记忆')
    }
  }

  const saveMemoryEdit = async () => {
    const entry = memoryEditEntry
    const text = String(fieldDraft).trim()
    const rt = runtime()
    if (entry === undefined || rt === undefined || memoryTarget === undefined) return
    if (text === '') {
      setNotice('记忆内容不能为空。')
      return
    }
    // The panel owns exactly one memory place: a Bot's own or team memory, or
    // one group's memory. An entry that names any other scope did not come from
    // this panel; refuse instead of writing across the boundary.
    const allowed = memoryTarget.roomId !== undefined ? ['group'] : ['own', 'team']
    if (!allowed.includes(entry.scope)) {
      setNotice('只能编辑当前记忆面板里的条目。')
      setMode('memory')
      setMemoryEditEntry(undefined)
      return
    }
    if (text === entry.text) {
      setMode('memory')
      setMemoryEditEntry(undefined)
      setNotice('内容没有变化。')
      return
    }
    setBusy(true)
    try {
      await ensureWritable(rt)
      // DS Bot exposes no single-entry write endpoint. Replace is composed from
      // the two that exist: add the new line through memory-ask (the only add
      // surface, keeper-mediated), then remove the old line by its exact text.
      // Add first: a failed add leaves the old entry intact.
      const where = entry.scope === 'team'
        ? '团队记忆'
        : memoryTarget.roomId !== undefined ? '群聊记忆' : '这个 Bot 的记忆'
      const asked = await rt.memoryEndpoint('memory-ask', {
        ...memoryTarget,
        text: `只在${where}里新增一条，内容必须完全是：${text}。不要修改或删除其它条目。`,
      })
      const forgotten = await rt.memoryEndpoint('memory-forget', {
        ...memoryTarget,
        scope: entry.scope,
        topic: entry.topic,
        text: entry.text,
      })
      const view = forgotten ?? asked
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setMemoryReport({
        reply: String(asked?.reply ?? ''),
        changes: Array.isArray(asked?.changes) ? asked.changes : [],
      })
      setFieldDraft('')
      setMemoryEditEntry(undefined)
      setMode('memory')
      setNotice('记忆已更新。')
    } catch (error) {
      setNotice(`更新记忆失败：${error?.message ?? error}`)
      await openMemory(memoryTarget)
    } finally {
      setBusy(false)
    }
  }

  const undoMemoryTidy = async () => {
    const rt = runtime()
    if (!rt || memoryTarget === undefined) return
    if (memoryTidy === undefined) {
      setNotice('没有可撤销的整理')
      return
    }
    setBusy(true)
    try {
      const view = await rt.memoryEndpoint('memory-tidy-undo', {
        ...memoryTarget,
        scope: memoryTidy.scope,
        batch: memoryTidy.batch,
      })
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setMemoryReport(undefined)
      setNotice('已撤销上次整理。')
    } catch (error) {
      setNotice(`撤销整理失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const layerMemory = async (entry) => {
    if (entry === undefined) return
    const rt = runtime()
    if (!rt || memoryTarget === undefined || memoryTarget.roomId !== undefined) {
      setNotice('只有 Bot 记忆可以设团队共享')
      return
    }
    const always = entry.scope !== 'team'
    setBusy(true)
    try {
      const view = await rt.memoryEndpoint('memory-layer', {
        ...memoryTarget,
        scope: entry.scope,
        topic: entry.topic,
        text: entry.text,
        always,
      })
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setNotice(always ? '已设为团队共享。' : '已移回共享主题。')
    } catch (error) {
      setNotice(`移动记忆失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const memoryHereKey = (entry) => {
    if (memoryTarget?.roomId !== undefined) return `group:${memoryTarget.roomId}`
    const botId = memoryTarget?.botId ?? current?.id
    return botId === undefined ? undefined : `bot:${botId}`
  }

  const openMemoryMove = (entry) => {
    if (entry === undefined || memoryTarget === undefined) return
    const here = entry.scope === 'team' ? 'team' : memoryHereKey(entry)
    const items = []
    if (entry.scope !== 'team') items.push({ key: 'team', name: 'Team memory', kind: 'team' })
    for (const place of Array.isArray(memoryPlaces) ? memoryPlaces : []) {
      if (place?.key === undefined || place.key === here) continue
      items.push({ key: String(place.key), name: String(place.name ?? place.key), kind: place.kind })
    }
    if (items.length === 0) {
      setNotice('没有其它记忆可移动')
      return
    }
    setMemoryMoveEntry(entry)
    setMemoryPlaces(items)
    setMemoryMoveIndex(0)
    setMode('memory-move')
    setNotice('')
  }

  const applyMemoryMove = async (to) => {
    const entry = memoryMoveEntry
    if (entry === undefined || to === undefined || memoryTarget === undefined) return
    const rt = runtime()
    if (!rt) return
    const label = memoryPlaces.find((place) => place.key === to)?.name ?? to
    setBusy(true)
    try {
      const view = await rt.memoryEndpoint('memory-move', {
        ...memoryTarget,
        scope: entry.scope,
        topic: entry.topic,
        text: entry.text,
        to,
      })
      setMemoryEntries(Array.isArray(view?.entries) ? view.entries : [])
      setMemorySummary(typeof view?.summary?.text === 'string' ? view.summary.text : '')
      setMemoryTidy(view?.tidy ?? undefined)
      setMemoryPlaces(Array.isArray(view?.places) ? view.places : [])
      setMemoryMoveEntry(undefined)
      setMemoryIndex(0)
      setMode('memory')
      setNotice(`已移到 ${label}。`)
    } catch (error) {
      setNotice(`移动记忆失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const openMemoryHistory = async (before) => {
    const rt = runtime()
    if (!rt || memoryTarget === undefined) return
    setMode('memory-history')
    setMemoryHistoryBusy(true)
    setMemoryHistoryAt(0)
    setNotice('')
    try {
      const view = await rt.memoryEndpoint('memory-history', {
        ...memoryTarget,
        ...(before === undefined ? {} : { before }),
      })
      const rows = Array.isArray(view?.rows) ? view.rows : []
      setMemoryHistory(before === undefined ? rows : [...memoryHistory, ...rows])
      setMemoryHistoryMore(view?.more ?? undefined)
    } catch (error) {
      setNotice(`读取变更记录失败：${error?.message ?? error}`)
    } finally {
      setMemoryHistoryBusy(false)
    }
  }

  const restoreMemory = async (row) => {
    if (row === undefined || row.restored === true) return
    const rt = runtime()
    if (!rt || memoryTarget === undefined) return
    setBusy(true)
    try {
      await rt.memoryEndpoint('memory-restore', { ...memoryTarget, id: row.id })
      await openMemory(memoryTarget)
      setMode('memory-history')
      await openMemoryHistory()
      setNotice('已恢复这条变更。')
    } catch (error) {
      setNotice(`恢复失败：${error?.message ?? error}`)
    } finally {
      setBusy(false)
    }
  }

  const move = (delta) => {
    if (count === 0) return
    const at = Math.max(0, Math.min(count - 1, index + delta))
    const bot = bots[at]
    if (bot !== undefined) setSelectedId(bot.id)
    setPendingDelete(undefined)
    setNotice('')
  }

  const release = async (bot) => {
    const other = foreignOf(bot)
    if (other !== undefined) {
      setNotice(`该会话在另一个 TUI 窗口（pid ${other}）：去那个窗口按 Ctrl+D 退出，或 kill ${other} 后重试。`)
      return
    }
    if (typeof channel.stopBackgroundAgent !== 'function') {
      setNotice('当前后端不支持释放会话。')
      return
    }
    // A Bot owns its current Session and every earlier segment; a background
    // claim may sit on any of them. The mount ledger lags the registry by up to
    // one heartbeat, so ask the channel first and only use the ledger to tell
    // "nothing parked" apart from "parked in the foreground".
    const ids = [bot.sessionId, ...bot.segments]
    let released = 0
    for (const id of ids) {
      try {
        if (await channel.stopBackgroundAgent(id)) released += 1
      } catch {
        // One stuck view must not stop the rest.
      }
    }
    if (released > 0) {
      setNotice(`已释放 ${bot.name} 的终端占用（${released} 个会话）。`)
      return
    }
    const claimed = ids.some((id) => readMounts().get(String(id)) === process.pid)
    setNotice(claimed
      ? `${bot.name} 的会话正在前台运行，无法从这里释放。`
      : `${bot.name} 没有被本终端挂着的后台会话。`)
  }

  useInput((input, key) => {
    if (mode === 'help') {
      if (key.escape || input === 'q' || input === '?') {
        setMode('list')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setHelpAt((at) => Math.max(0, Math.min(at, helpMax) - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setHelpAt((at) => Math.min(helpMax, at + 1))
        return
      }
      if (key.return || input === ' ') {
        setMode('list')
        setNotice('')
      }
      return
    }
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
      if (key.return && !busy && team.pending.length > 0) {
        // The pending list can shrink while the view is open (another host
        // approves first); keep the highlight and Enter on the same item.
        const at = Math.min(approveIndex, team.pending.length - 1)
        void approve(team.pending[at])
      }
      return
    }
    if (mode === 'capabilities') {
      const items = capabilityList()
      if (key.escape) {
        setMode('list')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setCapIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setCapIndex((at) => Math.min(Math.max(0, items.length - 1), at + 1))
        return
      }
      if (key.return && !busy && items.length > 0) {
        // The list can shrink under us (another host unapproves), so never index
        // past the end: toggle the item the highlight is actually on.
        const at = Math.min(capIndex, items.length - 1)
        void toggleCapability(items[at])
      }
      return
    }
    if (mode === 'field') {
      if (key.escape) {
        setFieldKey(undefined)
        setMode(fieldTarget === 'room' ? 'group-edit' : 'edit')
        setNotice('')
        return
      }
      const multiline = fieldKey === 'instructions'
      if (key.return && (!multiline || key.ctrl === true)) {
        void saveField()
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        // A one-line field folds a pasted newline; instructions keep theirs,
        // with Ctrl+Enter to save (Enter inserts a line).
        const clean = multiline ? input : input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, multiline ? 4000 : 200))
      }
      return
    }
    if (mode === 'models') {
      if (key.escape) {
        setMode('edit')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openModels()
        return
      }
      if (key.upArrow || input === 'k') {
        setModelIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setModelIndex((at) => Math.min(Math.max(0, modelItems.length - 1), at + 1))
        return
      }
      if (key.return && !busy && modelItems.length > 0) {
        void applyModel(modelItems[Math.min(modelIndex, modelItems.length - 1)])
      }
      return
    }
    if (mode === 'efforts') {
      if (key.escape) {
        setMode('edit')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openEfforts()
        return
      }
      if (key.upArrow || input === 'k') {
        setEffortIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setEffortIndex((at) => Math.min(Math.max(0, effortItems.length - 1), at + 1))
        return
      }
      if (key.return && !busy && effortItems.length > 0) {
        void applyEffort(effortItems[Math.min(effortIndex, effortItems.length - 1)])
      }
      return
    }
    if (mode === 'permission') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setPermissionIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setPermissionIndex((at) => Math.min(Math.max(0, permissionOptions().length - 1), at + 1))
        return
      }
      if (key.return && !busy) {
        const item = permissionOptions()[Math.min(permissionIndex, Math.max(0, permissionOptions().length - 1))]
        if (item !== undefined) void applyBotPermission(item.value)
      }
      return
    }
    if (mode === 'sections') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      if (input === 'n') {
        setFieldDraft('')
        setMode('section-new')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setSectionIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setSectionIndex((at) => Math.min(team.sections.length, at + 1))
        return
      }
      if (key.return && !busy) {
        const at = Math.min(sectionIndex, team.sections.length)
        void applySection(at === 0 ? null : team.sections[at - 1].id)
      }
      return
    }
    if (mode === 'section-new') {
      if (key.escape) {
        setMode('sections')
        setNotice('')
        return
      }
      if (key.return && !busy) {
        const value = fieldDraft.trim()
        if (value === '') {
          setNotice('输入分组名')
          return
        }
        void createSection(value)
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, 80))
      }
      return
    }
    if (mode === 'browser') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      const grants = current?.browserGrants ?? []
      if (key.upArrow || input === 'k') {
        setBrowserIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setBrowserIndex((at) => Math.min(Math.max(0, grants.length - 1), at + 1))
        return
      }
      if (input === 'n') {
        setBrowserStep(0)
        setBrowserSite('')
        setFieldDraft('')
        setMode('browser-new')
        setNotice('')
        return
      }
      if (input === 'x' && grants.length > 0) {
        void removeBrowserGrant(Math.min(browserIndex, grants.length - 1))
      }
      return
    }
    if (mode === 'browser-new') {
      if (key.escape) {
        if (browserStep === 1) {
          setBrowserStep(0)
          setFieldDraft('')
          setNotice('')
        } else {
          setMode('browser')
          setNotice('')
        }
        return
      }
      if (key.return && !busy) {
        const value = fieldDraft.trim()
        if (browserStep === 0) {
          if (value === '') {
            setNotice('输入站点，例如 example.com 或 *')
            return
          }
          if (value !== '*' && value !== 'localhost' && !/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/i.test(value)) {
            setNotice('站点格式不对，例如 example.com 或 *')
            return
          }
          setBrowserSite(value.toLowerCase())
          setFieldDraft('')
          setBrowserStep(1)
          setNotice('输入权限：post, upload, download, delete 或 *')
          return
        }
        void submitBrowserGrant(value)
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, 120))
      }
      return
    }
    if (mode === 'computer') {
      if (key.escape || input === 'q') {
        setMode('list')
        setNotice('')
        return
      }
      if (input === 'r') {
        void retryComputer()
        return
      }
      if (key.return) {
        void toggleComputer()
        return
      }
      const flat = computerApps().flatMap((row) => row.apps.map((appKey) => ({ bot: row.bot, appKey })))
      if (key.upArrow || input === 'k') {
        setComputerAppIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setComputerAppIndex((at) => Math.min(Math.max(0, flat.length - 1), at + 1))
        return
      }
      if (input === 'x' && flat.length > 0) {
        void revokeComputerApp(flat[Math.min(computerAppIndex, flat.length - 1)])
      }
      return
    }
    if (mode === 'computer-level') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setComputerIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setComputerIndex((at) => Math.min(COMPUTER_LEVELS.length - 1, at + 1))
        return
      }
      if (key.return && !busy) {
        void applyComputerLevel(COMPUTER_LEVELS[Math.min(computerIndex, COMPUTER_LEVELS.length - 1)].id)
      }
      return
    }
    if (mode === 'edit') {
      if (key.escape || input === 'q') {
        setMode('list')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setEditIndex((at) => Math.max(0, Math.min(at, 19) - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setEditIndex((at) => Math.min(19, at + 1))
        return
      }
      if (key.return && !busy && editField !== undefined) {
        void runEdit(editField)
      }
      return
    }
    if (mode === 'groups') {
      if (key.escape || input === 'q') {
        setMode('list')
        setNotice('')
        return
      }
      if (input === 'n') {
        setGroupMembers([])
        setGroupMemberIndex(0)
        setMode('group-new')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setGroupIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setGroupIndex((at) => Math.min(Math.max(0, rooms.length - 1), at + 1))
        return
      }
      if (input === 'e' && currentRoom !== undefined) {
        setGroupEditIndex(0)
        setMode('group-edit')
        setNotice('')
        return
      }
      if (input === 'x' && currentRoom !== undefined) {
        void deleteRoom(currentRoom)
        return
      }
      if (key.return && currentRoom !== undefined) {
        void openRoom(currentRoom)
      }
      return
    }
    if (mode === 'group-new' || mode === 'group-members') {
      if (key.escape) {
        setMode(mode === 'group-new' ? 'groups' : 'group-edit')
        setNotice('')
        return
      }
      const at = Math.min(groupMemberIndex, Math.max(0, teamBots.length - 1))
      if (key.upArrow || input === 'k') {
        setGroupMemberIndex(Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setGroupMemberIndex(Math.min(Math.max(0, teamBots.length - 1), at + 1))
        return
      }
      if (input === ' ') {
        const bot = teamBots[at]
        if (bot !== undefined) {
          setGroupMembers((ids) => ids.includes(bot.id)
            ? ids.filter((id) => id !== bot.id)
            : [...ids, bot.id])
        }
        return
      }
      if (input === 'a') {
        setGroupMembers(teamBots.slice(0, 12).map((bot) => bot.id))
        return
      }
      if (key.return && !busy) {
        if (mode === 'group-new') void createGroup()
        else void saveRoomMembers()
      }
      return
    }
    if (mode === 'room-sections') {
      if (key.escape || input === 'q') {
        setMode('group-edit')
        setNotice('')
        return
      }
      if (input === 'n') {
        setFieldDraft('')
        setMode('room-section-new')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setRoomSectionIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setRoomSectionIndex((at) => Math.min(team.sections.length, at + 1))
        return
      }
      if (key.return && !busy) {
        const at = Math.min(roomSectionIndex, team.sections.length)
        void applyRoomSection(at === 0 ? null : team.sections[at - 1].id)
      }
      return
    }
    if (mode === 'room-section-new') {
      if (key.escape) {
        setMode('room-sections')
        setNotice('')
        return
      }
      if (key.return && !busy) {
        const value = fieldDraft.trim()
        if (value === '') {
          setNotice('输入分组名')
          return
        }
        void createRoomSection(value)
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, 80))
      }
      return
    }
    if (mode === 'room-permission') {
      if (key.escape || input === 'q') {
        setMode('group-edit')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setRoomPermissionIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setRoomPermissionIndex((at) => Math.min(permissionOptions().length, at + 1))
        return
      }
      if (key.return && !busy) {
        const at = Math.min(roomPermissionIndex, permissionOptions().length)
        void applyRoomPermission(at === 0 ? null : permissionOptions()[at - 1].value)
      }
      return
    }
    if (mode === 'group-edit') {
      if (key.escape || input === 'q') {
        setMode('groups')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setGroupEditIndex((at) => Math.max(0, Math.min(at, 10) - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setGroupEditIndex((at) => Math.min(10, at + 1))
        return
      }
      if (key.return && !busy && groupEditField !== undefined) {
        void runGroupEdit(groupEditField)
      }
      return
    }
    if (mode === 'approvals') {
      if (key.escape || input === 'q') {
        setMode('list')
        setApprovalHistoryOpen(false)
        setNotice('')
        return
      }
      if (input === 'h') {
        setApprovalHistoryOpen((open) => !open)
        setApproveIndex(0)
        return
      }
      if (key.upArrow || input === 'k') {
        setApproveIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setApproveIndex((at) => Math.min(Math.max(0, approvals.length - 1), at + 1))
        return
      }
      if (approvals.length > 0 && !approvalHistoryOpen) {
        const entry = approvals[Math.min(approveIndex, approvals.length - 1)]
        if (key.return && !busy) answerApproval(entry, 'allow')
        else if (input === 'x' && !busy) answerApproval(entry, 'reject')
      }
      return
    }
    if (mode === 'schedules') {
      if (key.escape || input === 'q') {
        setMode(scheduleTarget?.roomId === undefined ? 'edit' : 'group-edit')
        setNotice('')
        return
      }
      if (input === 'n') {
        setScheduleDraft({ title: '', prompt: '', kind: 'daily', value: '09:00', weekdays: [] })
        setScheduleStep(0)
        setFieldDraft('')
        setMode('schedule-new')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openSchedules(scheduleTarget)
        return
      }
      if (key.upArrow || input === 'k') {
        setScheduleIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        const list = mySchedules()
        setScheduleIndex((at) => Math.min(Math.max(0, list.length - 1), at + 1))
        return
      }
      if (input === 'x') {
        const list = mySchedules()
        void deleteSchedule(list[Math.min(scheduleIndex, list.length - 1)])
      }
      return
    }
    if (mode === 'schedule-new') {
      if (key.escape) {
        setMode('schedules')
        setNotice('')
        return
      }
      if (scheduleStep === 2) {
        const pick = (kind) => {
          setScheduleDraft((draft) => ({ ...draft, kind, value: '', weekdays: [] }))
          setFieldDraft('')
          setScheduleStep(3)
        }
        if (input === 'd') pick('daily')
        else if (input === 'w') pick('weekly')
        else if (input === 'e') pick('every')
        else if (input === 'a') pick('at')
        return
      }
      if (scheduleStep === 4) {
        if (/^[1-7]$/.test(input)) {
          const day = Number(input)
          setScheduleDraft((draft) => ({
            ...draft,
            weekdays: draft.weekdays.includes(day)
              ? draft.weekdays.filter((at) => at !== day)
              : [...draft.weekdays, day].sort(),
          }))
          return
        }
        if (key.return && !busy) {
          if (scheduleDraft.weekdays.length === 0) {
            setNotice('至少选一个星期')
            return
          }
          void submitSchedule()
        }
        return
      }
      const multiline = scheduleStep === 1
      if (key.return && (!multiline || key.ctrl === true)) {
        const value = fieldDraft.trim()
        if (scheduleStep === 0) {
          if (value === '') {
            setNotice('给任务起个名字')
            return
          }
          setScheduleDraft((draft) => ({ ...draft, title: value }))
          setFieldDraft('')
          setScheduleStep(1)
        } else if (scheduleStep === 1) {
          if (value === '') {
            setNotice('写下要 Bot 做的事')
            return
          }
          setScheduleDraft((draft) => ({ ...draft, prompt: value }))
          setFieldDraft('')
          setScheduleStep(2)
        } else if (scheduleStep === 3) {
          setScheduleDraft((draft) => ({ ...draft, value }))
          if (scheduleDraft.kind === 'weekly') {
            setFieldDraft('')
            setScheduleStep(4)
          } else {
            void submitSchedule(value)
          }
        }
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = multiline ? input : input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, multiline ? 4000 : 120))
      }
      return
    }
    if (mode === 'memory') {
      if (key.escape || input === 'q') {
        setMode(memoryTarget?.roomId === undefined ? 'edit' : 'group-edit')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openMemory(memoryTarget)
        return
      }
      if (key.upArrow || input === 'k') {
        setMemoryIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setMemoryIndex((at) => Math.min(Math.max(0, memoryEntries.length - 1), at + 1))
        return
      }
      if (input === 'a') {
        setFieldDraft('')
        setMode('memory-ask')
        setNotice('')
        return
      }
      if (input === 'p' && memoryEntries.length > 0) {
        void pinMemory(memoryEntries[Math.min(memoryIndex, memoryEntries.length - 1)])
        return
      }
      if (input === 'l' && memoryEntries.length > 0) {
        void layerMemory(memoryEntries[Math.min(memoryIndex, memoryEntries.length - 1)])
        return
      }
      if (input === 'm' && memoryEntries.length > 0) {
        openMemoryMove(memoryEntries[Math.min(memoryIndex, memoryEntries.length - 1)])
        return
      }
      if (key.return && !busy) {
        if (memoryEntries.length === 0) {
          setNotice('没有可编辑的记忆条目')
          return
        }
        const entry = memoryEntries[Math.min(memoryIndex, memoryEntries.length - 1)]
        setMemoryEditEntry(entry)
        setFieldDraft(entry.text)
        setMode('memory-edit')
        setNotice('')
        return
      }
      if (input === 't') {
        void undoMemoryTidy()
        return
      }
      if (input === 'h') {
        void openMemoryHistory()
        return
      }
      if (input === 'x' && memoryEntries.length > 0) {
        void forgetMemory(memoryEntries[Math.min(memoryIndex, memoryEntries.length - 1)])
      }
      return
    }
    if (mode === 'memory-move') {
      if (key.escape || input === 'q') {
        setMode('memory')
        setMemoryMoveEntry(undefined)
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setMemoryMoveIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setMemoryMoveIndex((at) => Math.min(Math.max(0, memoryPlaces.length - 1), at + 1))
        return
      }
      if (key.return && !busy) {
        const place = memoryPlaces[Math.min(memoryMoveIndex, Math.max(0, memoryPlaces.length - 1))]
        if (place !== undefined) void applyMemoryMove(place.key)
      }
      return
    }
    if (mode === 'memory-history') {
      if (key.escape || input === 'q') {
        setMode('memory')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openMemoryHistory()
        return
      }
      if (key.upArrow || input === 'k') {
        setMemoryHistoryAt((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setMemoryHistoryAt((at) => Math.min(Math.max(0, memoryHistory.length - 1), at + 1))
        return
      }
      if (input === 'n' && memoryHistoryMore !== undefined) {
        void openMemoryHistory(memoryHistoryMore)
        return
      }
      if (key.return && !busy && memoryHistory.length > 0) {
        void restoreMemory(memoryHistory[Math.min(memoryHistoryAt, memoryHistory.length - 1)])
      }
      return
    }
    if (mode === 'memory-ask') {
      if (key.escape) {
        setMode('memory')
        setNotice('')
        return
      }
      if (key.return && !busy) {
        void askMemory()
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, 400))
      }
      return
    }
    if (mode === 'memory-edit') {
      if (key.escape) {
        setMemoryEditEntry(undefined)
        setFieldDraft('')
        setMode('memory')
        setNotice('')
        return
      }
      if (key.return && key.ctrl === true) {
        setFieldDraft((at) => (at + '\n').slice(0, 4000))
        return
      }
      if (key.return && !busy) {
        void saveMemoryEdit()
        return
      }
      if (key.ctrl === true && input === 's') {
        void saveMemoryEdit()
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        setFieldDraft((at) => (at + input).slice(0, 4000))
      }
      return
    }
    if (mode === 'avatar') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setAvatarIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setAvatarIndex((at) => Math.min(AVATAR_SHAPES.length - 1, at + 1))
        return
      }
      if (input === 'i') {
        setFieldDraft('')
        setMode('avatar-path')
        setNotice('')
        return
      }
      if (input === 'x' && !busy) {
        void clearAvatar()
        return
      }
      if (key.return && !busy) {
        void applyAvatar(AVATAR_SHAPES[Math.min(avatarIndex, AVATAR_SHAPES.length - 1)])
      }
      return
    }
    if (mode === 'avatar-path') {
      if (key.escape) {
        setMode('avatar')
        setNotice('')
        return
      }
      if (key.return && !busy) {
        void submitAvatarPath()
        return
      }
      if (key.backspace || key.delete) {
        setFieldDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setFieldDraft((at) => (at + clean).slice(0, 400))
      }
      return
    }
    if (mode === 'colors') {
      if (key.escape || input === 'q') {
        setMode('edit')
        setNotice('')
        return
      }
      if (key.upArrow || input === 'k') {
        setColorIndex((at) => Math.max(0, at - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setColorIndex((at) => Math.min(BOT_COLORS.length - 1, at + 1))
        return
      }
      if (key.return && !busy) {
        void applyColor(BOT_COLORS[Math.min(colorIndex, BOT_COLORS.length - 1)])
      }
      return
    }
    if (mode === 'usage') {
      if (key.escape || input === 'q') {
        setMode('list')
        setNotice('')
        return
      }
      if (input === 'r') {
        void openUsage()
        return
      }
      if (input === 'd') {
        setUsageDays(1)
        void openUsage(1)
        return
      }
      if (input === 'w') {
        setUsageDays(7)
        void openUsage(7)
        return
      }
      if (input === 'm') {
        setUsageDays(30)
        void openUsage(30)
        return
      }
      return
    }
    if (mode === 'search') {
      if (key.escape) {
        setSearch('')
        setMode('list')
        setNotice('')
        return
      }
      if (key.return) {
        setMode('list')
        return
      }
      if (key.backspace || key.delete) {
        setSearch((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setSearch((at) => (at + clean).slice(0, 60))
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
      if (key.return && !busy) {
        void submitDraft()
        return
      }
      if (key.backspace || key.delete) {
        setDraft((at) => at.slice(0, -1))
        return
      }
      if (input && key.ctrl !== true && key.meta !== true) {
        // The roster draft is one line; a pasted paragraph must not break the
        // footer layout. Newlines become spaces; the chat composer keeps its
        // own multi-line behavior.
        const clean = input.replace(/[\r\n]+/g, ' ')
        if (clean !== '') setDraft((at) => (at + clean).slice(0, 400))
      }
      return
    }

    if (key.escape || input === 'q') {
      if (search.trim() !== '') {
        setSearch('')
        setNotice('')
        return
      }
      leave()
      return
    }
    if (key.upArrow || input === 'k') {
      move(-1)
      return
    }
    if (key.downArrow || input === 'j') {
      move(1)
      return
    }
    if (input === ' ') {
      setDetailOpen((open) => !open)
      return
    }
    if (input === '?') {
      setHelpAt(0)
      setMode('help')
      setNotice('')
      return
    }
    if (input === 'r') {
      setTeam(readTeam())
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (input === '/') {
      setSearch('')
      setMode('search')
      setNotice('')
      return
    }
    if (input === 'e' && current !== undefined) {
      setEditIndex(0)
      setMode('edit')
      setNotice('')
      return
    }
    if (input === 't') {
      const at = roomHere === undefined ? 0 : rooms.findIndex((room) => room.id === roomHere.id)
      setGroupIndex(at >= 0 ? at : 0)
      setMode('groups')
      setNotice('')
      return
    }
    if (input === 'a') {
      setApproveIndex(0)
      setApprovalHistoryOpen(false)
      setMode('approvals')
      setNotice('')
      return
    }
    if (input === 'g') {
      if (bots[0] !== undefined) setSelectedId(bots[0].id)
      return
    }
    if (input === 'G') {
      if (bots[count - 1] !== undefined) setSelectedId(bots[count - 1].id)
      return
    }
    if (input === 'n') {
      void createChief()
      return
    }
    if (input === 'm' && current !== undefined) {
      setMode('message')
      setDraft('')
      setPendingDelete(undefined)
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
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (input === 'v' && current !== undefined) {
      if (capabilityList().length === 0) {
        setNotice('没有可挂载的能力。')
        return
      }
      setCapIndex(0)
      setMode('capabilities')
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (input === 'c') {
      setMode('create')
      setDraft('')
      setPendingDelete(undefined)
      setNotice('')
      return
    }
    if (input === 's' && current !== undefined) {
      void stopBot(current)
      return
    }
    if (input === 'X' && current !== undefined) {
      // Distinct from `x` (delete): clearing a failure marker must never be one
      // key away from removing the Bot.
      if (clearFailure(current.sessionId)) {
        setPendingDelete(undefined)
        setNotice(`已清除 ${current.name} 的失败记录。`)
        rerender()
      } else {
        setNotice(`${current.name} 没有失败记录。`)
      }
      return
    }
    if (input === 'x' && current !== undefined) {
      if (current.main) {
        setNotice('Main Bot 不能删除。')
        setPendingDelete(undefined)
        return
      }
      if (pendingDelete === current.id && Date.now() - pendingDeleteAt < 5000) void deleteBot(current)
      else {
        setPendingDelete(current.id)
        setPendingDeleteAt(Date.now())
        setNotice(`再按一次 x 删除 ${current.name}（不可恢复）`)
      }
      return
    }
    if (input === 'y' && current !== undefined) {
      void openUsage()
      return
    }
    if (input === 'o') {
      void openComputer()
      return
    }
    if (input === 'u' && current !== undefined) {
      void release(current)
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

  // Why a Bot has no tools: DS Bot keeps the MCP connection state per Bot and
  // only the browser surfaces it. A terminal that cannot start `project-fs`
  // would otherwise look like "approved but still no tools".
  const capabilityNote = (() => {
    if (current === undefined) return undefined
    const rt = runtime()
    if (typeof rt?.capabilityStatusesView !== 'function') return undefined
    try {
      const statuses = rt.capabilityStatusesView()?.[current.id]
      if (statuses === undefined) return undefined
      const bad = Object.entries(statuses)
        .filter(([, status]) => status?.state === 'error' || status?.state === 'connecting' || status?.state === 'needs-approval')
      if (bad.length === 0) return undefined
      return bad
        .map(([name, status]) => `${name}: ${status.state}${typeof status.error === 'string' && status.error !== '' ? ` ${status.error}` : ''}`)
        .join(' · ')
    } catch {
      return undefined
    }
  })()

  const header = h(Box, { key: 'header', flexDirection: 'column' },
    h(Text, null,
      h(Text, { bold: true, color: 'accent' }, ' DS Bot '),
      h(Text, { color: 'subtle' }, ` ${total} 位${needle === '' ? '' : ` · 筛选 ${count}`}`),
      rooms.length > 0 ? h(Text, { color: 'subtle' }, ` · ${rooms.length} 群`) : null,
      working > 0 ? h(Text, { color: 'accent' }, ` · 工作 ${working}`) : null,
      waiting > 0 ? h(Text, { color: 'warning' }, ` · 待回答 ${waiting}`) : null,
      unread > 0 ? h(Text, { color: 'success' }, ` · 未读 ${unread}`) : null,
      team.pending.length > 0 ? h(Text, { color: 'warning' }, ` · 待授权 ${team.pending.length}`) : null,
      approvals.length > 0 ? h(Text, { color: 'warning' }, ` · 待审批 ${approvals.length}`) : null,
      here === undefined && roomHere === undefined ? null : h(Text, { color: 'success' }, ` · 当前 ${here?.name ?? roomHere.name}`),
      columns >= 96 ? h(Text, { color: 'inactive' }, `   ${channel.provider}/${channel.model}`) : null,
    ),
    team.foreign === undefined
      ? null
      : h(Text, { color: 'warning' }, `⚠ 另一个 DS Bot 持有团队锁（pid ${team.foreign.pid}），本终端只读。`),
    team.error === '' ? null : h(Text, { color: 'error' }, team.error),
  )

  const rowsView = []
  const showRole = columns >= 56
  const showStatus = columns >= 42
  for (let at = offset; at < Math.min(offset + listHeight, count); at += 1) {
    const bot = bots[at]
    const selected = at === index
    const status = statusOf(bot)
    const previous = at > 0 ? bots[at - 1] : undefined
    if (bot.sectionId !== undefined && (previous === undefined || previous.sectionId !== bot.sectionId)) {
      rowsView.push(h(Text, { key: `section-${bot.sectionId}`, color: 'inactive' }, `── ${sectionName(bot.sectionId)}`))
    }
    rowsView.push(h(Box, { key: bot.id, flexDirection: 'row' },
      h(Text, { color: selected ? 'accent' : 'subtle' }, selected ? ' ❯ ' : '   '),
      h(Text, { color: bot.main ? 'accent' : 'text' }, bot.main ? `${MAIN_MARK} ` : '  '),
      h(Text, { bold: selected, color: selected ? 'accent' : 'text' }, pad(bot.name, 13)),
      showRole ? h(Text, { color: 'subtle' }, pad(bot.role || '—', 16)) : null,
      showStatus ? h(Text, { color: status.color }, pad(status.text, 10)) : null,
      bot.live?.failure === undefined ? null : h(Text, { color: 'error' }, ' !失败'),
      here?.id === bot.id ? h(Text, { color: 'success' }, ' 当前')
        : foreignOf(bot) !== undefined ? h(Text, { color: 'warning' }, ` 他窗:${foreignOf(bot)}`)
          : bot.unread > 0 ? h(Text, { color: 'success' }, ' ●新') : null,
      bot.blocked === undefined ? null : h(Text, { color: 'error' }, ` ${bot.blocked}`),
      bot.waiting ? h(Text, { color: 'warning' }, ' 待开场') : null,
    ))
  }

  const detailMessages = current?.live?.messages ?? []
  const detailLatest = detailMessages.length > 0 ? detailMessages[detailMessages.length - 1] : undefined
  const detailStatus = current === undefined ? undefined : statusOf(current)
  const detailRunning = current?.live === undefined
    ? '暂无实时记录'
    : current.live.status === 'idle'
    ? `最后活动 ${current.live.lastAt === 0 ? '—' : relative(current.live.lastAt)}`
    : `已运行 ${elapsed(current.live.since)}`
  const detailWidth = Math.min(48, Math.max(32, columns - 48))
  const detailWide = current !== undefined && columns >= 100
  const detailPanel = current === undefined ? null : h(Box, { key: 'detail', flexDirection: 'column' },
    h(Text, { bold: true, color: 'accent' }, truncate(current.name, Math.max(8, detailWidth - 2))),
    h(Text, { color: 'subtle' }, truncate(`${current.role || '无角色'}${current.sectionId === undefined ? '' : ` · ${sectionName(current.sectionId)}`}`, Math.max(8, detailWidth - 2))),
    h(Text, null,
      h(Text, { color: detailStatus.color }, detailStatus.text),
      h(Text, { color: 'inactive' }, ` · ${detailRunning}`),
    ),
    current.live?.failure === undefined
      ? null
      : h(Box, { key: 'failure', flexDirection: 'column' },
        h(Text, { color: 'error' }, `!失败 · ${relative(current.live.failure.at)}`),
        h(Text, { color: 'warning' }, truncate(`原因 ${current.live.failure.reason ?? '原因未知'}`, Math.max(8, detailWidth - 2))),
        h(Text, { color: 'inactive' }, truncate(`来源 ${current.live.failure.source} · X 清除`, Math.max(8, detailWidth - 2))),
      ),
    h(Text, { color: 'inactive' }, truncate(`模型 ${current.model || '默认'}`, Math.max(8, detailWidth - 2))),
    h(Text, { color: 'inactive' }, truncate(`目录 ${current.workDir || '团队工作区'}`, Math.max(8, detailWidth - 2))),
    h(Text, { color: current.unread > 0 ? 'success' : 'inactive' }, `未读 ${current.unread}`),
    foreignOf(current) === undefined
      ? null
      : h(Text, { color: 'warning' }, truncate(`占用：pid ${foreignOf(current)}`, Math.max(8, detailWidth - 2))),
    capabilityNote === undefined ? null : h(Text, { color: 'warning' }, truncate(capabilityNote, Math.max(8, detailWidth - 2))),
    h(Text, { color: 'subtle' }, '最近消息'),
    detailMessages.length === 0
      ? h(Text, { color: 'inactive' }, '暂无消息')
      : detailMessages.map((message, at) => h(Box, { key: `${message.at}-${at}`, flexDirection: 'column' },
        h(Text, null,
          h(Text, { color: message.role === 'user' ? 'accent' : 'success' }, message.role === 'user' ? '你' : 'Bot'),
          h(Text, { color: 'inactive' }, ` · ${relative(message.at)}`),
        ),
        h(Text, { color: 'text' }, truncate(message.text, Math.max(8, detailWidth - 2))),
      )),
    h(Text, { color: 'inactive' }, 'Enter 进入 · m 发消息 · s 停止'),
    h(Text, { color: 'inactive' }, 'space 折叠'),
  )
  const detailLine = current === undefined ? null : h(Box, { key: 'detail', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: detailStatus.color }, truncate([
      current.live?.failure === undefined
        ? ''
        : `!失败 ${current.live.failure.reason ?? '原因未知'} · ${relative(current.live.failure.at)}`,
      detailStatus.text,
      detailRunning,
      current.model || '默认',
      current.workDir === '' ? '' : current.workDir,
      current.unread > 0 ? `未读 ${current.unread}` : '',
    ].filter((part) => part !== '').join(' · '), Math.max(8, columns - 2))),
    h(Text, { color: 'text' }, truncate([
      '最近：',
      detailLatest === undefined
        ? '暂无消息'
        : `${detailLatest.role === 'user' ? '你' : 'Bot'}: ${detailLatest.text}`,
    ].join(''), Math.max(8, columns - 2))),
  )
  const detail = !detailOpen || current === undefined ? null : detailWide ? detailPanel : detailLine

  const boundNames = (name) => {
    const bound = team.bots.filter((bot) => bot.capabilities.includes(name)).map((bot) => bot.name)
    return bound.length === 0
      ? '未绑定任何 Bot（批准后也不会自动挂载）'
      : `已绑定：${bound.join('、')}`
  }

  const approveAt = Math.min(approveIndex, Math.max(0, team.pending.length - 1))
  const approveView = mode !== 'approve' ? null : h(Box, { key: 'approve', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '待授权的 MCP 能力'),
    ...team.pending.map((item, at) => h(Box, { key: item.name, flexDirection: 'column' },
      h(Box, { flexDirection: 'row' },
        h(Text, { color: at === approveAt ? 'accent' : 'subtle' }, at === approveAt ? ' ❯ ' : '   '),
        h(Text, { bold: at === approveAt, color: at === approveAt ? 'accent' : 'text' }, pad(item.name, 16)),
        h(Text, { color: 'subtle' }, truncate(item.description, Math.max(8, columns - 24))),
      ),
      h(Text, { color: 'inactive' }, `   ${boundNames(item.name)}`),
    )),
    h(Text, { color: 'inactive' }, '批准后会立即挂载给已绑定它的 Bot；首次启动 MCP 可能慢几秒。'),
  )

  const capabilityItems = capabilityList()
  const capAt = Math.min(capIndex, Math.max(0, capabilityItems.length - 1))
  const capView = mode !== 'capabilities' ? null : h(Box, { key: 'capabilities', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的能力`),
    ...(capabilityItems.length === 0
      ? [h(Text, { color: 'subtle' }, '没有可挂载的能力；stdio MCP 先按 p 批准。')]
      : capabilityItems.map((item, at) => h(Box, { key: item.name, flexDirection: 'row' },
        h(Text, { color: at === capAt ? 'accent' : 'subtle' }, at === capAt ? ' ❯ ' : '   '),
        h(Text, { bold: at === capAt, color: at === capAt ? 'accent' : 'text' }, pad(item.name, 16)),
        h(Text, { color: item.attached ? 'success' : 'subtle' }, item.attached ? ' 已挂载' : ' 未挂载'),
        h(Text, { color: 'subtle' }, ` ${truncate(item.description ?? '', Math.max(8, columns - 35))}`),
      ))),
  )

  const editRows = current === undefined ? [] : editFields(current)
  const editOffset = Math.max(0, Math.min(editAt - listHeight + 1, editRows.length - listHeight))
  const editView = mode !== 'edit' ? null : h(Box, { key: 'edit', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的设置（Enter 修改，Esc 返回）`),
    ...editRows.slice(editOffset, editOffset + listHeight).map((field, at) => {
      const index = editOffset + at
      return h(Box, { key: field.key, flexDirection: 'row' },
        h(Text, { color: index === editAt ? 'accent' : 'subtle' }, index === editAt ? ' ❯ ' : '   '),
        h(Text, { bold: index === editAt, color: index === editAt ? 'accent' : 'text' }, pad(field.label, 14)),
        h(Text, { color: field.danger ? 'error' : index === editAt ? 'text' : 'subtle' },
          truncate(field.value || (field.danger ? '删除' : '—'), Math.max(8, columns - 24))),
      )
    }),
  )

  const fieldLabel = fieldKey === 'role' ? 'Label'
    : fieldKey === 'instructions' ? 'Instructions'
    : fieldKey === 'workDir' ? 'Folder'
    : fieldKey === 'notice' ? 'Notice'
    : 'Name'
  const fieldCurrent = fieldTarget === 'room' ? currentRoom?.[fieldKey] : current?.[fieldKey]
  const fieldView = mode !== 'field' ? null : h(Box, { key: 'field', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${fieldTarget === 'room' ? '群聊' : 'Bot'} · 编辑 ${fieldLabel}`),
    h(Text, null,
      h(Text, { color: 'accent' }, ' ❯ '),
      h(Text, null, fieldDraft === '' ? ' ' : fieldDraft),
      fieldDraft === '' && fieldKey !== 'instructions'
        ? h(Text, { color: 'inactive' }, ` 当前：${fieldCurrent === undefined || fieldCurrent === '' ? '（空）' : fieldCurrent}`)
        : null,
    ),
    h(Text, { color: 'inactive' }, fieldKey === 'instructions'
      ? 'Enter 换行 · Ctrl+Enter 保存 · Esc 取消'
      : 'Enter 保存 · Esc 取消'),
  )

  const modelAt = Math.min(modelIndex, Math.max(0, modelItems.length - 1))
  const modelOffset = Math.max(0, Math.min(modelAt - listHeight + 1, modelItems.length - listHeight))
  const modelView = mode !== 'models' ? null : h(Box, { key: 'models', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的模型（Enter 应用，Esc 返回）`),
    modelBusy
      ? h(Text, { color: 'subtle' }, '读取模型…')
      : modelItems.length === 0
      ? h(Text, { color: 'subtle' }, '没有可用模型')
      : modelItems.slice(modelOffset, modelOffset + listHeight).map((item, at) => {
        const index = modelOffset + at
        return h(Box, { key: item.ref, flexDirection: 'row' },
          h(Text, { color: index === modelAt ? 'accent' : 'subtle' }, index === modelAt ? ' ❯ ' : '   '),
          h(Text, { bold: index === modelAt, color: index === modelAt ? 'accent' : 'text' }, pad(item.name, 22)),
          h(Text, { color: 'subtle' }, pad(item.provider, 14)),
          item.needsKey ? h(Text, { color: 'error' }, ' 需要密钥') : null,
          item.ref === current?.model ? h(Text, { color: 'success' }, ' 当前') : null,
        )
      }),
  )

  const roomAt = Math.min(groupIndex, Math.max(0, rooms.length - 1))
  const roomOffset = Math.max(0, Math.min(roomAt - listHeight + 1, rooms.length - listHeight))
  const groupView = mode !== 'groups' ? null : h(Box, { key: 'groups', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `群聊（${rooms.length}）· Enter 打开 · n 新建 · e 设置 · x 删除 · Esc 返回`),
    rooms.length === 0
      ? h(Text, { color: 'subtle' }, '还没有群聊 · 按 n 新建（至少两个 Bot）')
      : rooms.slice(roomOffset, roomOffset + listHeight).map((room, at) => {
        const index = roomOffset + at
        return h(Box, { key: room.id, flexDirection: 'row' },
          h(Text, { color: index === roomAt ? 'accent' : 'subtle' }, index === roomAt ? ' ❯ ' : '   '),
          h(Text, { bold: index === roomAt, color: index === roomAt ? 'accent' : 'text' }, pad(room.name, 20)),
          h(Text, { color: 'subtle' }, pad(`${room.members.length} 位`, 6)),
          h(Text, { color: 'inactive' }, pad(room.mode === 'admin' ? '仅管理员' : '所有人', 10)),
          room.id === channel.sessionId ? h(Text, { color: 'success' }, ' 当前') : null,
        )
      }),
  )

  const memberAt = Math.min(groupMemberIndex, Math.max(0, teamBots.length - 1))
  const memberOffset = Math.max(0, Math.min(memberAt - listHeight + 1, teamBots.length - listHeight))
  const memberView = mode !== 'group-new' && mode !== 'group-members' ? null : h(Box, { key: 'members', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, mode === 'group-new'
      ? '新建群聊：选择成员（空格切换，a 全选，Enter 创建）'
      : `编辑成员：${currentRoom?.name ?? '?'}（空格增删，a 全选，Enter 保存）`),
    teamBots.length === 0
      ? h(Text, { color: 'subtle' }, '还没有 Bot')
      : teamBots.slice(memberOffset, memberOffset + listHeight).map((bot, at) => {
        const index = memberOffset + at
        const on = groupMembers.includes(bot.id)
        return h(Box, { key: bot.id, flexDirection: 'row' },
          h(Text, { color: index === memberAt ? 'accent' : 'subtle' }, index === memberAt ? ' ❯ ' : '   '),
          h(Text, { color: on ? 'success' : 'subtle' }, on ? '[x]' : '[ ]'),
          h(Text, { bold: index === memberAt, color: index === memberAt ? 'accent' : 'text' }, ` ${pad(bot.name, 14)}`),
          h(Text, { color: 'subtle' }, pad(bot.role || '—', 16)),
          bot.main ? h(Text, { color: 'accent' }, '★') : null,
        )
      }),
    h(Text, { color: 'inactive' }, `已选 ${groupMembers.length} 位（至少 2 位，最多 12 位）`),
  )

  const groupEditRows = currentRoom === undefined ? [] : roomFields(currentRoom)
  const groupEditView = mode !== 'group-edit' ? null : h(Box, { key: 'group-edit', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${currentRoom?.name ?? '?'} 的设置（Enter 修改，Esc 返回）`),
    ...groupEditRows.map((field, at) => h(Box, { key: field.key, flexDirection: 'row' },
      h(Text, { color: at === groupEditAt ? 'accent' : 'subtle' }, at === groupEditAt ? ' ❯ ' : '   '),
      h(Text, { bold: at === groupEditAt, color: at === groupEditAt ? 'accent' : 'text' }, pad(field.label, 14)),
      h(Text, { color: field.danger ? 'error' : at === groupEditAt ? 'text' : 'subtle' },
        truncate(field.value || (field.danger ? '删除' : '—'), Math.max(8, columns - 24))),
    )),
  )

  const roomSectionAt = Math.min(roomSectionIndex, team.sections.length)
  const roomSectionOptions = [null, ...team.sections.map((section) => section.id)]
  const roomSectionsView = mode !== 'room-sections' ? null : h(Box, { key: 'room-sections', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${currentRoom?.name ?? '?'} 的分组（Enter 应用 · n 新建 · Esc 返回）`),
    ...roomSectionOptions.map((id, at) => h(Box, { key: id ?? 'none', flexDirection: 'row' },
      h(Text, { color: at === roomSectionAt ? 'accent' : 'subtle' }, at === roomSectionAt ? ' ❯ ' : '   '),
      h(Text, {
        bold: at === roomSectionAt,
        color: at === roomSectionAt ? 'accent' : currentRoom?.sectionId === id ? 'success' : 'text',
      }, id === null ? '无（未分组）' : sectionName(id)),
      currentRoom?.sectionId === id ? h(Text, { color: 'success' }, ' 当前') : null,
    )),
    team.sections.length === 0 ? h(Text, { color: 'inactive' }, '还没有分组 · 按 n 新建') : null,
  )
  const roomPermissionAt = Math.min(roomPermissionIndex, permissionOptions().length)
  const roomPermissionView = mode !== 'room-permission' ? null : h(Box, { key: 'room-permission', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${currentRoom?.name ?? '?'} 的权限（Enter 应用 · Esc 返回）`),
    h(Box, { flexDirection: 'row' },
      h(Text, { color: roomPermissionAt === 0 ? 'accent' : 'subtle' }, roomPermissionAt === 0 ? ' ❯ ' : '   '),
      h(Text, { bold: roomPermissionAt === 0, color: roomPermissionAt === 0 ? 'accent' : 'text' }, '各自（成员用自己的权限）'),
      currentRoom?.permission === undefined ? h(Text, { color: 'success' }, ' 当前') : null,
    ),
    ...permissionOptions().map((item, at) => {
      const index = at + 1
      return h(Box, { key: item.value, flexDirection: 'column' },
        h(Box, { flexDirection: 'row' },
          h(Text, { color: index === roomPermissionAt ? 'accent' : 'subtle' }, index === roomPermissionAt ? ' ❯ ' : '   '),
          h(Text, {
            bold: index === roomPermissionAt,
            color: item.value === 'danger-full-access' ? 'error' : index === roomPermissionAt ? 'text' : 'subtle',
          }, pad(item.name || item.value, 20)),
          h(Text, { color: 'subtle' }, item.value ?? ''),
          currentRoom?.permission === item.value ? h(Text, { color: 'success' }, ' 当前') : null,
        ),
        item.description ? h(Text, { color: 'inactive' }, `   ${truncate(item.description, Math.max(8, columns - 6))}`) : null,
      )
    }),
    h(Text, { color: 'inactive' }, '替代每个成员自己的权限，仅在这个群里生效。'),
  )
  const roomSectionNewView = mode !== 'room-section-new' ? null : h(Box, { key: 'room-section-new', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '新建分组（Enter 保存 · Esc 取消）'),
    h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, fieldDraft === '' ? ' ' : fieldDraft)),
    h(Text, { color: 'inactive' }, `当前群聊：${currentRoom?.name ?? '?'}`),
  )

  const approvalsAt = Math.min(approveIndex, Math.max(0, approvals.length - 1))
  const approvalOutcome = (outcome) => outcome === 'allowed-once'
    ? '允许'
    : outcome === 'rejected' ? '拒绝' : outcome === 'cancelled' ? '取消' : String(outcome ?? '已决')
  const approvalTarget = (entry) => {
    const name = entry.botId === undefined ? undefined : botName(entry.botId)
    const where = name ?? (entry.sessionId === undefined || entry.sessionId === null
      ? '?'
      : truncate(String(entry.sessionId), 20))
    return entry.roomId === undefined ? where : `${where} · 群聊`
  }
  const approvalHistoryList = approvalHistory()
  const approvalHistoryRows = approvalHistoryList.slice(0, listHeight).map((entry) => {
    const outcome = approvalOutcome(entry.outcome)
    return h(Box, { key: entry.id, flexDirection: 'column' },
      h(Box, { flexDirection: 'row' },
        h(Text, { color: 'inactive' }, `${new Date(entry.decidedAt ?? entry.at ?? Date.now()).toLocaleString()}  `),
        h(Text, { color: entry.outcome === 'allowed-once' ? 'success' : 'warning' }, pad(outcome, 6)),
        h(Text, { color: 'text' }, `${approvalTarget(entry)}  `),
        h(Text, { color: 'text' }, truncate(entry.tool || '请求', 18)),
      ),
      h(Text, { color: 'inactive' }, `   ${truncate(entry.reason || '没有说明', Math.max(8, columns - 6))}`),
    )
  })
  const approvalsView = mode !== 'approvals' ? null : h(Box, { key: 'approvals', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, approvalHistoryOpen
      ? `已决审批（本终端记录 ${approvalHistoryList.length}）· h 返回待审批 · Esc 返回`
      : `待审批（${approvals.length}）· Enter 允许 · x 拒绝 · h 历史 · Esc 返回`),
    approvalHistoryOpen
      ? (approvalHistoryList.length === 0
        ? h(Text, { color: 'subtle' }, '本终端还没有已决审批（只记录本终端回答的请求）')
        : approvalHistoryRows)
      : approvals.length === 0
      ? h(Text, { color: 'subtle' }, '没有待审批的请求')
      : approvals.slice(0, listHeight).map((entry, at) => h(Box, { key: entry.id, flexDirection: 'column' },
        h(Box, { flexDirection: 'row' },
          h(Text, { color: at === approvalsAt ? 'accent' : 'subtle' }, at === approvalsAt ? ' ❯ ' : '   '),
          h(Text, { bold: at === approvalsAt, color: at === approvalsAt ? 'accent' : 'text' }, pad(entry.tool || '请求', 18)),
          h(Text, { color: 'subtle' }, `${botName(entry.botId)}${entry.roomId === undefined ? '' : ' · 群聊'}`),
        ),
        h(Text, { color: 'inactive' }, `   ${truncate(entry.reason || '没有说明', Math.max(8, columns - 6))}`),
        entry.detail ? h(Text, { color: 'inactive' }, `   ${truncate(String(entry.detail), Math.max(8, columns - 6))}`) : null,
      )),
  )

  const timingText = (task) => {
    if (task.kind === 'daily') return `每天 ${String(task.time ?? '').slice(0, 5)}`
    if (task.kind === 'weekly') return `每周 ${(task.weekdays ?? []).join(',')} ${String(task.time ?? '').slice(0, 5)}`
    if (task.kind === 'every') return `每 ${Math.round(Number(task.everySeconds ?? 0) / 60)} 分钟`
    if (task.kind === 'at' || task.kind === 'after') {
      const at = new Date(task.scheduledAt)
      return Number.isNaN(at.getTime()) ? '一次' : at.toLocaleString()
    }
    return String(task.kind ?? '')
  }
  const taskStateText = (task) => task.state === 'overdue' ? '已过期'
    : task.state === 'paused' ? '已暂停'
    : task.state === 'finished' ? '已结束'
    : task.scheduledAt === undefined ? '' : `下次 ${new Date(task.scheduledAt).toLocaleString()}`
  const myScheduleList = mySchedules()
  const scheduleAt = Math.min(scheduleIndex, Math.max(0, myScheduleList.length - 1))
  const scheduleOffset = Math.max(0, Math.min(scheduleAt - listHeight + 1, myScheduleList.length - listHeight))
  const scheduleView = mode !== 'schedules' ? null : h(Box, { key: 'schedules', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${scheduleTarget?.name ?? '?'} 的定时任务（n 新建 · x 删除 · r 刷新 · Esc 返回）`),
    scheduleBusy
      ? h(Text, { color: 'subtle' }, '读取中…')
      : !scheduleAvailable
      ? h(Text, { color: 'warning' }, 'DSH 的 Automation tasks 没有启用')
      : myScheduleList.length === 0
      ? h(Text, { color: 'subtle' }, '没有定时任务 · 按 n 新建')
      : myScheduleList.slice(scheduleOffset, scheduleOffset + listHeight).map((task, at) => {
        const index = scheduleOffset + at
        return h(Box, { key: task.id ?? `${task.title}-${index}`, flexDirection: 'column' },
          h(Box, { flexDirection: 'row' },
            h(Text, { color: index === scheduleAt ? 'accent' : 'subtle' }, index === scheduleAt ? ' ❯ ' : '   '),
            h(Text, { bold: index === scheduleAt, color: index === scheduleAt ? 'accent' : 'text' }, pad(task.title, 24)),
            h(Text, { color: 'subtle' }, timingText(task)),
          ),
          h(Text, { color: 'inactive' }, `   ${taskStateText(task)}`),
        )
      }),
  )

  const scheduleNewView = mode !== 'schedule-new' ? null : h(Box, { key: 'schedule-new', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '新建定时任务（Esc 取消）'),
    h(Text, { color: 'subtle' }, scheduleStep === 0
      ? '名称（例如：早间简报）'
      : scheduleStep === 1
      ? '要做什么（Enter 换行，Ctrl+Enter 下一步）'
      : scheduleStep === 2
      ? '频率：d 每天 · w 每周 · e 每隔 · a 一次'
      : scheduleStep === 4
      ? `选星期（1–7 切换 · Enter 保存）：${scheduleDraft.weekdays.join(' ') || '未选'}`
      : `时间（${scheduleDraft.kind === 'at' ? 'YYYY-MM-DDTHH:MM' : scheduleDraft.kind === 'every' ? '分钟数' : 'HH:MM'}）`),
    h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, fieldDraft === '' ? ' ' : fieldDraft)),
    h(Text, { color: 'inactive' }, `目标：${scheduleTarget?.name ?? '?'} · ${scheduleDraft.title === '' ? '（未命名）' : scheduleDraft.title}`),
  )

  const avatarAt = Math.min(avatarIndex, AVATAR_SHAPES.length - 1)
  const avatarRows = [0, 5, 10, 15].map((start) => h(Box, { key: start, flexDirection: 'row' },
    ...AVATAR_SHAPES.slice(start, start + 5).map((shape, at) => {
      const index = start + at
      return h(Text, {
        key: shape,
        bold: index === avatarAt,
        color: index === avatarAt ? 'accent' : current?.avatar?.shape === shape ? 'success' : 'text',
      }, `${index === avatarAt ? '❯ ' : '  '}${pad(shape, 10)}`)
    }),
  ))
  const avatarView = mode !== 'avatar' ? null : h(Box, { key: 'avatar', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的头像（Enter 应用 · i 图片路径 · x 恢复默认 · Esc 返回）`),
    ...avatarRows,
    current?.avatar?.image ? h(Text, { color: 'success' }, '当前：自定义图片') : null,
  )

  const colorAt = Math.min(colorIndex, BOT_COLORS.length - 1)
  const colorView = mode !== 'colors' ? null : h(Box, { key: 'colors', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的颜色（Enter 应用 · Esc 返回）`),
    [0, 5, 10, 15].map((start) => h(Box, { key: start, flexDirection: 'row' },
      ...BOT_COLORS.slice(start, start + 5).map((color, at) => {
        const index = start + at
        return h(Text, {
          key: color,
          bold: index === colorAt,
          color: index === colorAt ? 'accent' : current?.color === color ? 'success' : 'text',
        }, `${index === colorAt ? '❯ ' : '  '}${pad(color, 11)}`)
      }),
    )),
  )

  const effortAt = Math.min(effortIndex, Math.max(0, effortItems.length - 1))
  const effortOffset = Math.max(0, Math.min(effortAt - listHeight + 1, effortItems.length - listHeight))
  const effortsView = mode !== 'efforts' ? null : h(Box, { key: 'efforts', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的思考级别（Enter 应用 · r 刷新 · Esc 返回）`),
    effortBusy
      ? h(Text, { color: 'subtle' }, '读取中…')
      : effortItems.length === 0
      ? h(Text, { color: 'subtle' }, '该模型没有思考级别')
      : effortItems.slice(effortOffset, effortOffset + listHeight).map((item, at) => {
        const index = effortOffset + at
        return h(Box, { key: item.id ?? item.name, flexDirection: 'column' },
          h(Box, { flexDirection: 'row' },
            h(Text, { color: index === effortAt ? 'accent' : 'subtle' }, index === effortAt ? ' ❯ ' : '   '),
            h(Text, { bold: index === effortAt, color: index === effortAt ? 'accent' : 'text' }, pad(item.name || item.id || '?', 16)),
            h(Text, { color: 'subtle' }, item.id || ''),
            item.id === current?.effort ? h(Text, { color: 'success' }, ' 当前') : null,
          ),
          item.description ? h(Text, { color: 'inactive' }, `   ${truncate(item.description, Math.max(8, columns - 6))}`) : null,
        )
      }),
  )

  const permissionAt = Math.min(permissionIndex, Math.max(0, permissionOptions().length - 1))
  const permissionOffset = Math.max(0, Math.min(permissionAt - listHeight + 1, permissionOptions().length - listHeight))
  const permissionItems = permissionOptions()
  const permissionView = mode !== 'permission' ? null : h(Box, { key: 'permission', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的权限（Enter 应用 · Esc 返回）`),
    permissionItems.length === 0
      ? h(Text, { color: 'subtle' }, '当前 DSH 没有提供权限预设')
      : permissionItems.slice(permissionOffset, permissionOffset + listHeight).map((item, at) => {
        const index = permissionOffset + at
        const danger = item.value === 'danger-full-access'
        return h(Box, { key: item.value, flexDirection: 'column' },
          h(Box, { flexDirection: 'row' },
            h(Text, { color: index === permissionAt ? 'accent' : 'subtle' }, index === permissionAt ? ' ❯ ' : '   '),
            h(Text, {
              bold: index === permissionAt,
              color: danger ? 'error' : index === permissionAt ? 'text' : 'subtle',
            }, pad(item.name || item.value, 20)),
            h(Text, { color: 'subtle' }, item.value ?? ''),
            item.value === (current?.permission ?? permissionCatalog()?.defaultPreset)
              ? h(Text, { color: 'success' }, ' 当前') : null,
          ),
          item.description ? h(Text, { color: 'inactive' }, `   ${truncate(item.description, Math.max(8, columns - 6))}`) : null,
        )
      }),
  )

  const sectionNewView = mode !== 'section-new' ? null : h(Box, { key: 'section-new', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '新建分组（Enter 保存 · Esc 取消）'),
    h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, fieldDraft === '' ? ' ' : fieldDraft)),
    h(Text, { color: 'inactive' }, `当前 Bot：${current?.name ?? '?'}`),
  )

  const sectionAt = Math.min(sectionIndex, team.sections.length)
  const sectionOptions = [null, ...team.sections.map((section) => section.id)]
  const sectionsView = mode !== 'sections' ? null : h(Box, { key: 'sections', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的分组（Enter 应用 · n 新建 · Esc 返回）`),
    sectionOptions.map((id, at) => h(Box, { key: id ?? 'none', flexDirection: 'row' },
      h(Text, { color: at === sectionAt ? 'accent' : 'subtle' }, at === sectionAt ? ' ❯ ' : '   '),
      h(Text, {
        bold: at === sectionAt,
        color: at === sectionAt ? 'accent' : current?.sectionId === id ? 'success' : 'text',
      }, id === null ? '无（未分组）' : sectionName(id)),
      current?.sectionId === id ? h(Text, { color: 'success' }, ' 当前') : null,
    )),
    team.sections.length === 0 ? h(Text, { color: 'inactive' }, '还没有分组 · 在聊天里让 Chief 建一个') : null,
  )

  const browserGrants = current?.browserGrants ?? []
  const browserAt = Math.min(browserIndex, Math.max(0, browserGrants.length - 1))
  const browserView = mode !== 'browser' ? null : h(Box, { key: 'browser', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的浏览器授权（n 新建 · x 撤销 · Esc 返回）`),
    browserGrants.length === 0
      ? h(Text, { color: 'subtle' }, '没有授权 · 在聊天里批准浏览器请求，或按 n 手动添加')
      : browserGrants.map((grant, at) => h(Box, { key: `${grant.site}-${at}`, flexDirection: 'row' },
        h(Text, { color: at === browserAt ? 'accent' : 'subtle' }, at === browserAt ? ' ❯ ' : '   '),
        h(Text, { bold: at === browserAt, color: at === browserAt ? 'accent' : 'text' }, pad(truncate(grant.site, 24), 26)),
        h(Text, { color: 'inactive' }, grant.kinds.join(',')),
        grant.until === undefined ? null : h(Text, { color: 'subtle' }, `  至 ${new Date(grant.until).toLocaleDateString()}`),
      )),
  )
  const browserNewView = mode !== 'browser-new' ? null : h(Box, { key: 'browser-new', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '新建浏览器授权（Esc 取消）'),
    h(Text, { color: 'subtle' }, browserStep === 0
      ? '站点（example.com 或 *）'
      : `站点：${browserSite} · 权限（${BROWSER_KINDS.join(', ')}）`),
    h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, fieldDraft === '' ? ' ' : fieldDraft)),
  )

  const computerRows = computerApps()
  const computerFlat = computerRows.flatMap((row) => row.apps.map((appKey) => ({ bot: row.bot, appKey })))
  const computerAppAt = Math.min(computerAppIndex, Math.max(0, computerFlat.length - 1))
  const computerPanelView = mode !== 'computer' ? null : h(Box, { key: 'computer-panel', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, 'Computer（Enter 开关 · r 重试 · x 撤销应用 · Esc 返回）'),
    computerPanelBusy
      ? h(Text, { color: 'subtle' }, '读取中…')
      : h(Box, { flexDirection: 'column' },
        h(Text, null,
          h(Text, { color: computerPanel?.enabled === true ? 'success' : 'inactive' }, `总开关：${computerPanel?.enabled === true ? '开' : '关'}`),
          h(Text, { color: 'subtle' }, ` · 提供方：${computerPanel?.provider?.state ?? '未知'}`),
          computerPanel?.macos === true ? h(Text, { color: 'inactive' }, ' · macOS') : null,
        ),
        ...computerRows.map((row) => h(Box, { key: row.bot.id, flexDirection: 'column' },
          h(Box, { flexDirection: 'row' },
            h(Text, { color: 'subtle' }, '  '),
            h(Text, { bold: true, color: 'text' }, pad(truncate(row.bot.name, 16), 18)),
            h(Text, { color: 'inactive' }, computerLevelName(row.level)),
            h(Text, { color: 'subtle' }, ` · ${row.apps.length} 个应用`),
          ),
          ...row.apps.map((appKey) => {
            const index = computerFlat.findIndex((item) => item.bot.id === row.bot.id && item.appKey === appKey)
            return h(Box, { key: appKey, flexDirection: 'row' },
              h(Text, { color: index === computerAppAt ? 'accent' : 'subtle' }, index === computerAppAt ? ' ❯ ' : '    '),
              h(Text, { color: index === computerAppAt ? 'text' : 'subtle' }, truncate(appKey, Math.max(8, columns - 10))),
              h(Text, { color: 'inactive' }, '  x 撤销'),
            )
          }),
        )),
        computerFlat.length === 0 ? h(Text, { color: 'inactive' }, '没有已授权的应用 · 在聊天里批准浏览器请求后会出现在这里') : null,
      ),
  )

  const computerAt = Math.min(computerIndex, COMPUTER_LEVELS.length - 1)
  const computerOn = (() => {
    const rt = runtime()
    try {
      return rt?.computerEnabled?.() === true
    } catch {
      return false
    }
  })()
  const computerLevelView = mode !== 'computer-level' ? null : h(Box, { key: 'computer', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${current?.name ?? '?'} 的 Computer 权限（Enter 应用 · Esc 返回）`),
    ...COMPUTER_LEVELS.map((item, at) => h(Box, { key: item.id, flexDirection: 'row' },
      h(Text, { color: at === computerAt ? 'accent' : 'subtle' }, at === computerAt ? ' ❯ ' : '   '),
      h(Text, {
        bold: at === computerAt,
        color: at === computerAt ? 'accent' : (current?.computerLevel || 'background') === item.id ? 'success' : 'text',
      }, pad(item.name, 12)),
      h(Text, { color: 'inactive' }, item.id),
      (current?.computerLevel || 'background') === item.id ? h(Text, { color: 'success' }, ' 当前') : null,
    )),
    computerOn ? null : h(Text, { color: 'warning' }, 'Computer 总开关未启用：在 DS Bot 里打开后这里才生效。'),
  )

  const compact = (n) => Number(n) >= 1e6
    ? `${(Number(n) / 1e6).toFixed(1)}M`
    : Number(n) >= 1e3 ? `${(Number(n) / 1e3).toFixed(1)}k` : String(Number(n))
  const usageTotal = usageItems.reduce((sum, item) => ({
    calls: sum.calls + item.calls,
    tokens: sum.tokens + item.input + item.output + item.cacheRead + item.cacheWrite,
  }), { calls: 0, tokens: 0 })
  const usageView = mode !== 'usage' ? null : h(Box, { key: 'usage', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `用量（${current?.name ?? '?'} · 近 ${usageDays} 天 · d/w/m 切换 · r 刷新 · Esc 返回）`),
    usageBusy
      ? h(Text, { color: 'subtle' }, '统计中…')
      : usageItems.length === 0
      ? h(Text, { color: 'subtle' }, '还没有记录')
      : usageItems.slice(0, listHeight).map((item, at) => {
        const mine = (item.kind === 'bot' || item.kind === 'room') && item.id === current?.id
        return h(Box, { key: item.key, flexDirection: 'row' },
          h(Text, { color: mine ? 'accent' : 'subtle' }, mine ? ' ❯ ' : '   '),
          h(Text, { bold: mine, color: mine ? 'accent' : 'text' }, pad(truncate(item.name, 16), 18)),
          h(Text, { color: 'subtle' }, pad(`${compact(item.calls)} 次`, 8)),
          h(Text, { color: 'inactive' }, `入 ${compact(item.input)} · 出 ${compact(item.output)} · 缓存 ${compact(item.cacheRead + item.cacheWrite)}`),
        )
      }),
    usageItems.length === 0 ? null : h(Text, { color: 'inactive' }, `合计：${compact(usageTotal.calls)} 次调用 · ${compact(usageTotal.tokens)} tokens`),
  )

  const memoryAt = Math.min(memoryIndex, Math.max(0, memoryEntries.length - 1))
  const memoryOffset = Math.max(0, Math.min(memoryAt - listHeight + 1, memoryEntries.length - listHeight))
  const memoryName = memoryTarget?.roomId === undefined
    ? current?.name
    : rooms.find((room) => room.id === memoryTarget.roomId)?.name
  const memoryView = mode !== 'memory' ? null : h(Box, { key: 'memory', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${memoryName ?? '?'} 的记忆（a 提问 · Enter 编辑 · p 置顶 · l 共享 · t 撤销整理 · h 历史 · x 忘记 · r 刷新 · Esc 返回）`),
    memoryTidy === undefined ? null : h(Text, { color: 'inactive' },
      truncate(`上次整理：${new Date(memoryTidy.at).toLocaleString()} · 合并 ${memoryTidy.merged ?? 0} · 移动 ${memoryTidy.moved ?? 0} · 归档 ${memoryTidy.retired ?? 0} · t 撤销`, Math.max(20, columns * 2))),
    memorySummary === '' ? null : h(Text, { color: 'inactive' }, truncate(`摘要：${memorySummary}`, Math.max(20, columns * 2))),
    memoryReport === undefined ? null : h(Box, { flexDirection: 'column' },
      h(Text, { color: memoryReport.changes.some((change) => change.ok === false) ? 'warning' : 'success' },
        memoryReport.changes.length === 0
          ? '没有改动'
          : memoryReport.changes.map((change) => `${change.ok === false ? '✗' : '✓'} ${change.op}`).join(' · ')),
      memoryReport.reply === '' ? null : h(Text, { color: 'subtle' }, truncate(memoryReport.reply, Math.max(20, columns * 2))),
    ),
    memoryBusy
      ? h(Text, { color: 'subtle' }, '读取中…')
      : memoryEntries.length === 0
      ? h(Text, { color: 'subtle' }, '还没有记忆条目')
      : memoryEntries.slice(memoryOffset, memoryOffset + listHeight).map((entry, at) => {
        const index = memoryOffset + at
        const topic = entry.topic === null || entry.topic === undefined ? '' : String(entry.topic)
        return h(Box, { key: entry.id, flexDirection: 'row' },
          h(Text, { color: index === memoryAt ? 'accent' : 'subtle' }, index === memoryAt ? ' ❯ ' : '   '),
          entry.pinned ? h(Text, { color: 'accent' }, '★ ') : null,
          topic === '' ? null : h(Text, { color: 'inactive' }, `[${topic}] `),
          h(Text, { color: index === memoryAt ? 'text' : 'subtle' }, truncate(entry.text, Math.max(8, columns - 8 - (topic === '' ? 0 : topic.length + 3)))),
        )
      }),
  )

  const memoryMoveAt = Math.min(memoryMoveIndex, Math.max(0, memoryPlaces.length - 1))
  const memoryMoveView = mode !== 'memory-move' ? null : h(Box, { key: 'memory-move', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '移动记忆（Enter 选择 · Esc 返回）'),
    h(Text, { color: 'inactive' }, truncate(String(memoryMoveEntry?.text ?? ''), Math.max(8, columns - 4))),
    ...memoryPlaces.map((place, at) => h(Box, { key: place.key, flexDirection: 'row' },
      h(Text, { color: at === memoryMoveAt ? 'accent' : 'subtle' }, at === memoryMoveAt ? ' ❯ ' : '   '),
      h(Text, {
        bold: at === memoryMoveAt,
        color: at === memoryMoveAt ? 'accent' : 'text',
      }, pad(place.name, 24)),
      h(Text, { color: 'subtle' }, place.kind === 'team' ? '团队' : place.kind === 'bot' ? 'Bot' : '群聊'),
    )),
    memoryPlaces.length === 0 ? h(Text, { color: 'subtle' }, '没有其它记忆可移动') : null,
  )

  const memoryAskView = mode !== 'memory-ask' ? null : h(Box, { key: 'memory-ask', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, '让 Bot 整理记忆（Enter 发送 · Esc 取消）'),
    h(Text, { color: 'subtle' }, '例如：记住我喜欢简洁回答 / 删掉关于旧项目的条目'),
    h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, fieldDraft === '' ? ' ' : fieldDraft)),
  )

  const memoryEditLines = fieldDraft.split('\n')
  const memoryEditHeight = Math.max(3, Math.min(10, rows - 14))
  const memoryEditTop = Math.max(0, memoryEditLines.length - memoryEditHeight)
  const memoryEditScope = memoryEditEntry?.scope === 'team'
    ? '团队记忆'
    : memoryEditEntry?.scope === 'group' ? '群聊记忆' : 'Bot 自己的记忆'
  const memoryEditView = mode !== 'memory-edit' ? null : h(Box, { key: 'memory-edit', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `编辑记忆（${memoryName ?? '?'} · Enter 保存 · Ctrl+Enter 换行 · Ctrl+S 保存 · Esc 取消）`),
    h(Text, { color: 'inactive' }, truncate(`目标：${memoryEditScope} · 原：${memoryEditEntry?.text ?? ''}`, Math.max(8, columns - 4))),
    ...memoryEditLines.slice(memoryEditTop, memoryEditTop + memoryEditHeight).map((line, at) => {
      const index = memoryEditTop + at
      const caret = index === memoryEditLines.length - 1
      return h(Text, { key: index, color: caret ? 'text' : 'subtle' }, ` ❯ ${caret && line === '' ? ' ' : truncate(line, Math.max(6, columns - 6))}`)
    }),
    busy ? h(Text, { color: 'accent' }, '保存中…') : null,
  )

  const historyAt = Math.min(memoryHistoryAt, Math.max(0, memoryHistory.length - 1))
  const historyOffset = Math.max(0, Math.min(historyAt - listHeight + 1, memoryHistory.length - listHeight))
  const memoryHistoryView = mode !== 'memory-history' ? null : h(Box, { key: 'memory-history', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `${memoryName ?? '?'} 的变更记录（Enter 恢复 · n 更早 · r 刷新 · Esc 返回）`),
    busy
      ? h(Text, { color: 'accent' }, '处理中…')
      : memoryHistoryBusy
      ? h(Text, { color: 'subtle' }, '读取中…')
      : memoryHistory.length === 0
      ? h(Text, { color: 'subtle' }, '没有变更记录')
      : memoryHistory.slice(historyOffset, historyOffset + listHeight).map((row, at) => {
        const index = historyOffset + at
        const when = new Date(row.time)
        return h(Box, { key: row.id, flexDirection: 'row' },
          h(Text, { color: index === historyAt ? 'accent' : 'subtle' }, index === historyAt ? ' ❯ ' : '   '),
          h(Text, { color: 'inactive' }, pad(Number.isNaN(when.getTime()) ? '—' : when.toLocaleString(), 20)),
          h(Text, { color: row.op === 'remove' ? 'warning' : 'text' }, pad(row.op === 'add' ? '新增' : row.op === 'remove' ? '删除' : '修改', 6)),
          h(Text, { color: 'subtle' }, pad(row.scope, 6)),
          row.restored ? h(Text, { color: 'success' }, '已恢复 ') : null,
          h(Text, { color: index === historyAt ? 'text' : 'subtle' }, truncate(String(row.text ?? ''), Math.max(8, columns - 42))),
        )
      }),
    memoryHistoryMore === undefined ? null : h(Text, { color: 'inactive' }, '还有更早的变更 · n 加载'),
  )

  const helpView = mode !== 'help' ? null : h(Box, { key: 'help', flexDirection: 'column', marginTop: 1 },
    h(Text, { color: 'accent' }, `按键帮助（${helpTop + 1}–${Math.min(helpTop + helpHeight, HELP_ENTRIES.length)} / ${HELP_ENTRIES.length} 行）`),
    ...HELP_ENTRIES.slice(helpTop, helpTop + helpHeight).map((entry, at) => {
      if (entry.kind === 'title') {
        return h(Text, { key: `title-${helpTop + at}`, bold: true, color: 'accent' }, `── ${entry.text}`)
      }
      return h(Box, { key: `row-${helpTop + at}`, flexDirection: 'row' },
        h(Text, { color: 'text' }, pad(entry.key, 20)),
        h(Text, { color: 'inactive' }, truncate(entry.description, Math.max(8, columns - 22))),
      )
    }),
  )

  const fullViewNode = approveView ?? capView ?? helpView ?? editView ?? fieldView ?? modelView ?? effortsView ?? permissionView ?? sectionNewView ?? sectionsView ?? browserNewView ?? browserView ?? computerLevelView ?? computerPanelView ?? avatarView ?? colorView ?? usageView ?? groupView ?? memberView ?? groupEditView ?? roomSectionNewView ?? roomSectionsView ?? roomPermissionView ?? approvalsView ?? scheduleView ?? scheduleNewView ?? memoryEditView ?? memoryAskView ?? memoryMoveView ?? memoryHistoryView ?? memoryView
  const fullFooter = fullViewNode === null ? null : h(Box, { key: 'full-footer', flexDirection: 'column', marginTop: 1 },
    busy ? h(Text, { color: 'accent' }, '处理中…') : null,
    notice === '' ? null : h(Text, { color: 'warning' }, notice),
    h(Text, { color: 'inactive' }, modeHint(mode, { fieldKey, scheduleStep, approvalHistoryOpen })),
  )

  const footer = fullViewNode !== null
    ? fullFooter
    : mode === 'list' || mode === 'search'
    ? h(Box, { key: 'footer', flexDirection: 'column', marginTop: 1 },
      busy ? h(Text, { color: 'accent' }, '处理中…') : null,
      mode === 'search'
        ? h(Text, null, h(Text, { color: 'accent' }, ' 搜索 '), h(Text, null, search === '' ? ' ' : search))
        : null,
      notice === '' ? null : h(Text, { color: 'warning' }, notice),
      h(Text, { color: 'subtle' }, modeHint(mode)),
      search.trim() === '' ? null : h(Text, { color: 'accent' }, `搜索：${search}（/ 修改 · Esc 清除）`),
      h(Text, { color: 'subtle' }, `c 新建 · s 停止 · x 删除 · space 详情 · q 返回${current?.live?.failure === undefined ? '' : ' · X 清除失败'}${team.pending.length > 0 ? ' · p 授权' : ''}${capabilityItems.length > 0 ? ' · v 能力' : ''}${current !== undefined && (foreignOf(current) !== undefined || heldByThisTerminal(current)) ? ' · u 释放' : ''}`),
      h(Text, { color: 'subtle' }, `e 设置 · t 群聊 · y 用量 · o 电脑${approvals.length > 0 ? ` · a 审批 ${approvals.length}` : ''}`),
      h(Text, { color: 'inactive' }, '进入聊天后人格、记忆、团队工具都由 Bot 运行时接管。'),
    )
    : h(Box, { key: 'footer', flexDirection: 'column', marginTop: 1 },
      h(Text, { color: 'accent' }, mode === 'message' ? `发给 ${current?.name ?? '?'}（输入后 Enter 发送，Esc 取消）` : '新建 Bot（名称,角色,开场任务，例如 Dev,编码,先读 README）'),
      h(Text, null, h(Text, { color: 'accent' }, ' ❯ '), h(Text, null, draft === '' ? ' ' : draft)),
      notice === '' ? null : h(Text, { color: 'warning' }, notice),
      h(Text, { color: 'inactive' }, modeHint(mode)),
    )

  const empty = total === 0
    ? h(Text, { color: 'subtle' }, '还没有团队 · 按 n 创建第一位 Main Bot（Chief）')
    : count === 0
    ? h(Text, { color: 'subtle' }, `没有匹配「${search}」的 Bot · Esc 清除`)
    : h(Box, { flexDirection: 'column' }, rowsView)

  const body = fullViewNode ?? (detailWide && detail !== null
    ? h(Box, { key: 'body', flexDirection: 'row', width: '100%' },
      h(Box, { flexDirection: 'column', width: Math.max(20, columns - detailWidth - 4) }, empty),
      h(Box, { flexDirection: 'column', width: detailWidth, paddingLeft: 1 }, detail))
    : h(Box, { key: 'body', flexDirection: 'column' }, empty, detail))

  return h(Box, { flexDirection: 'column', width: '100%', paddingX: 1 },
    header,
    body,
    h(Box, { flexGrow: 1 }),
    footer,
  )
}
