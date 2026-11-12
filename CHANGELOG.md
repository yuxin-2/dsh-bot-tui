# Changelog

只记录真实版本号与已经落地的能力。0.10.0–0.13.0 是开发过程中的工作区版本号；
0.13.0 是首次把完整工作区提交、并对齐 `package.json` 的版本。

## 0.24.0

- 名册分组标题行可折叠/展开：标题行可聚焦，`←` 折叠、`→` 展开（`Enter` 也可切换）；折叠后该组只显示标题与成员数。
- 折叠状态保存在 `$DSH_TUI_HOME/dsh-bot-tui-collapsed.json`（与已读状态同一目录，不写 DS Bot 的 `state.json`），重启终端后保持。
- 折叠组内的 Bot 不参与光标导航，展开后回到折叠前选中的成员。
- 搜索时自动展开所有命中分组，清除搜索后恢复用户自己的折叠状态。
- 新增 `src/collapse.js` 与 `test/probes/collapse.tsx`，覆盖折叠、展开、持久化、搜索自动展开与隐藏行不可选中。

## 0.23.0

- 详情面板接上 `sessionController.page()`：聚焦详情时 `PgUp` 读更早一页、`PgDn` 读更晚一页，每页 20 条，用 `beforeSeq` 续读、`hasMore` 判断是否还有更早。
- 头部显示「历史 · 第 N 页 · 还有更早 / 已到最早」；首屏仍是最近 5 条实时消息，翻页后明确标为历史，`PgDn` 回到最新页后回到实时。
- 会话没有持久化历史、运行时没有 `page` 能力或读取失败时，详情面板给出明确文字而不是空白。
- 新增 `test/probes/detail-paging.tsx`，覆盖翻页、到底、空历史与无 `page` 能力降级。

## 0.22.0

- 名册按 `S` 批量停止所有正在工作的 Bot：第一次按下只列出会停哪几个并等待确认，再按 `S` 执行、`Esc` 取消。
- 逐个调用现有 `stopChat`，单个失败只在结果里报告、不中断其余 Bot；结束后显示成功/已空闲/失败数与失败原因，并重读 `state.json` 刷新名册。
- 没有工作中的 Bot 时按 `S` 只提示，不发起任何停止调用。
- 新增 `test/probes/stop-all.tsx`，覆盖多个工作中、部分失败、没有工作中与取消确认。

## 0.21.0

- 记忆面板按 `Enter` 内联编辑选中条目：多行输入，`Enter` 或 `Ctrl+S` 保存、`Ctrl+Enter` 换行、`Esc` 取消；保存后刷新条目、摘要与变更记录。
- DS Bot 没有单条记忆的写入接口，编辑由现有接口组合：先 `memory-ask` 新增改后的条目，再按原文精确 `memory-forget` 删除旧条目；先加后删，加失败时旧条目不动。
- 只允许编辑当前记忆面板里的条目：Bot 面板只接受 `own`/`team`，群聊面板只接受 `group`，越界条目直接拒绝、不发写请求。
- 新增 `test/probes/memory-edit.tsx`，覆盖进入编辑、保存、Ctrl+S、取消、空白拒绝与写错目标被拒。

## 0.20.0

- `src/activity.js` 记录每个会话最近一次失败：时间、简短原因（优先 `turn/end` 的 `error.message`，其次 `error.code`）、来源事件类型。
- 名册行显示 `!失败`，详情面板显示原因、相对时间与来源；成功回合后自动清除。
- `X` 清除选中 Bot 的失败记录，与 `x`（连按两次删除）完全分开。
- 新增 `test/probes/failure.tsx`，覆盖失败出现、行/详情显示、实时出现、成功清除、显式清除与不误删。

## 0.19.0

- 审批面板 `a` 内按 `h` 切换已决审批历史：列出时间、Bot/会话、请求摘要与允许/拒绝/取消。
- DS Bot 只保留待审批请求，不保存已决记录；历史由本终端进程内记录（最多 50 条，不落盘、不跨窗口），面板明确标注。
- 支持 DS Bot 的 `onApproval` 结算事件，也覆盖旧运行时下 TUI 自己回答的请求。
- 新增 `src/approvalHistory.js` 与 `test/probes/approve-history.tsx`。

## 0.18.0

- 补上 `sessionController.page()`：从 `ctx.sessionPersistence` 以只读方式打开会话日志，按 `throughSeq` / `beforeSeq` / `maxMessages` 向前分页。
- 记录保持 DSH 的 `{ type: 'event', event }` 形状与时间顺序，`hasMore` 表示更早还有记录；会话不存在或没有记录时返回空页。
- 交接备注与记忆回读不再因空实现而退化；新增 `test/probes/paging.tsx` 覆盖正常分页、边界、替换事件、分组与陌生 sessionId。

## 0.17.0

- 名册改用 `node:fs` 监听 `$DSH_HOME/bot` 目录，`state.json` 变更 120ms 去抖后重读。
- 监听不可用或 watcher 出错时退化为每 1.5 秒轮询；卸载时关闭 watcher 与定时器。
- 空闲且监听可用时不再有每秒一次的读取。
- 新增 `src/watch.js` 与 `test/probes/watching.tsx`：覆盖 watch 触发、退化路径与 cleanup。

## 0.16.0

- 名册按 `?` 打开按键帮助浮层：按名册 / Bot 设置 / 群聊 / 记忆 / 定时 / Computer / 用量分区列出全部按键，↑↓ 滚动，Esc 返回。
- 每个 mode 的底栏都有一行统一格式的按键提示；名册底栏补上 `? 帮助`。
- 新增 `test/probes/help.tsx`：断言 `?` 开关帮助、帮助覆盖全部按键与分区、每个 mode 都有提示行。

## 0.15.0

- 名册详情面板：终端 ≥100 列时显示右侧固定栏，否则在列表下方显示两行摘要。
- 详情显示状态与已运行时长、模型、工作目录、未读数、最近 5 条消息（user/assistant、相对时间）与快捷动作。
- `src/activity.js` 按会话保留最近 5 条消息（每条 160 字，带角色与时间戳），仅进程内，不写 `state.json`。
- 光标移动时详情跟随；`space` 折叠/展开详情。
- 新增 `test/probes/detail.tsx`，覆盖有 live 记录与无记录两种渲染。

## 0.14.0

- 测试基座：14 个无头探针迁入 `test/probes/`，路径相对仓库根，不再依赖 `/tmp`。
- `pnpm test`：逐个运行探针并打印 PASS/FAIL，同时执行 `node --check`；任一失败非零退出。
- 每个探针使用 `test/.probe-home/` 下的独立 HOME，不读写开发者的真实 DS Bot 状态。
- 版本对齐：`package.json` 与 `dsh-plugin.json` 均为 0.14.0。
- README 中英文补充 `pnpm test` 用法。无运行时行为变化。

## 0.13.0

首次提交的完整版本，包含 0.10.0 起的全部能力，以及：

- 群聊 Section：群设置中移动/新建侧边栏分组，花名册按分组排序。
- Permission 预设：Bot 与群聊可应用 DSH `permissionPresets`，完全访问标红；无该服务时提示不可用。
- 记忆移动：记忆面板 `m` 把条目移到团队记忆、其它 Bot 或群聊。
- 版本对齐：`package.json` 与 `dsh-plugin.json` 均为 0.13.0。

## 0.10.0

- 名册：搜索、实时状态、快捷发消息、停止回合、创建 Chief、释放会话占用、他窗占用提示。
- Bot 设置：资料、头像（形状/本地图片）、颜色、思考级别、指令、模型、目录、私密/置顶/隐藏、
  Main Bot、分组、Computer 权限、Browser 授权、记忆、定时、复制、删除。
- 群聊：创建/打开/改名、成员勾选、管理员、回复模式、目录、公告、记忆、定时、删除。
- 审批：允许/拒绝；待批准 MCP 能力审批，以及能力挂载/卸载。
- 定时任务：每天、每周（1–7）、每隔、一次。
- 记忆：提问、置顶、共享、撤销整理、变更记录恢复、忘记。
- 用量：按 Bot 汇总，支持一天/一周/一月。
- Computer 面板：总开关、提供方重试、按 Bot 级别、撤销应用授权。
- 可选的 dsh-TUI transcript 补丁。