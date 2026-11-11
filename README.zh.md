# dsh-bot-tui

[English](README.md) · [中文](README.zh.md)

**把 DS Bot 的 Bot 团队搬进终端 —— 基于 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI)。**

`dsh-bot-tui` 是一个 [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) 插件，
把 [DS Bot](https://github.com/Fei2411/DS-Bot) 的 Bot 团队接进终端：`/bots`
打开全屏团队列表，`Enter` 进入该 Bot 的聊天。Bot 的人格、记忆、模型和团队工具
都还在——每一轮由同一个 DSH 内核里的 DS Bot 运行时执行。

> 状态：实验性。已在 dsh-TUI 0.19.0、DSH 0.2.2-rc.1、DS Bot 0.3.2 上验证。
> 与 dsh-TUI、DS Bot 官方无隶属关系。

---

## 基于 dsh-TUI 的部分

本项目**不是 dsh-TUI 的分叉**，也没有改它一行代码。它是一个第三方插件，只消费
dsh-TUI 的公开插件接缝：

| dsh-TUI 接缝 | 本插件的用法 |
| --- | --- |
| `ctx.tuiScenes.register()` | 注册 `ds-bot-team` 全屏场景（`/bots` 列表页） |
| `ctx.commands.register()` | 注册打开它的 `/bots` 斜杠命令 |
| `TuiSceneProps.channel` | 读 `channel.provider` / `channel.model` 用终端当前模型路由建 Bot；调 `channel.resumeTo(sessionId)` 打开 Bot 聊天 |

这里**刻意没有聊天渲染层**：进入 Bot 后调用 `channel.resumeTo()`，把终端交还
dsh-TUI 自己的 Chat 屏。你看到的历史、输入框、流式输出、卡片，全部由 dsh-TUI
组装；场景只负责列表。

唯一会调的是转录区的“外观”：见[终端渲染](#终端渲染)，一个四文件的 dsh-TUI
补丁去掉行首的 `⏺`/`⎿` 符号、给代码块加强调边框。它是可选的——原版 dsh-TUI
上插件照常工作。

React 契约同样遵循 dsh-TUI：场景只用 `TuiSceneProps` 注入的 `React` 与 `ui`
组件，跑在 dsh-TUI 自己的 React 19 reconciler 上，不引入第二份 React，也不碰
私有模块。

## 基于 DS Bot 的部分

DS Bot 以「DSH 插件 + 浏览器端」发布。本包把宿主半边挂进 TUI profile，并补上
浏览器半边原本提供的两个服务，于是 Bot 运行时不需要 Web 服务器也能工作：

| 行 | 作用 |
| --- | --- |
| `dsh-bot-tui/connection` | 提供 `connection` 服务。DS Bot 在这上面注册 `/api/bot` 与 `/api/bot/feed`；终端没有 HTTP 服务，所以只收下注册、保留 disposer 契约。 |
| `dsh-bot-tui/controller` | 基于本地 `ctx.agents` 提供 `sessionController`：`create`、`selectModel`、`prompt`、`resolveAgent`、`page`。DS Bot 用它建 Bot/群会话、切模型、投递消息。 |
| `dsh-bot-tui` | 上面的 `/bots` 命令与列表场景。 |

仍然属于 DS Bot 的：Bot 身份、花名册、人格与系统提示词、记忆、Bot 间消息、
群聊、审批、交接、定时。仍然属于 DSH 的：agent loop、工具、模型路由、会话。
本仓库两者都不重写。

## 安装

需要 Node `^22.19` 或 `>=24`、可用的 `dsh`，以及装在某个 profile 里的
`dsh-TUI` 0.19.x。

### 1. 准备 DS Bot 与本插件

```bash
git clone https://github.com/Fei2411/DS-Bot.git
git clone https://github.com/yuxin-2/dsh-bot-tui.git
```

打上那一行运行时补丁（原因见下节）：

```bash
cd DS-Bot
git apply /path/to/dsh-bot-tui/patches/ds-bot-expose-runtime.patch
```

### 2. 装进 TUI profile

编辑 `~/.dsh/profiles/dsh-tui/package.json`：

```json
{
  "dependencies": {
    "@deepseek-harness-tui/dsh-tui": "0.19.0",
    "ds-bot": "file:/path/to/DS-Bot/ds-bot",
    "dsh-bot-tui": "link:/path/to/dsh-bot-tui"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-harness-tui/dsh-tui",
        "dsh-bot-tui"
      ],
      "patchReload": "live"
    }
  }
}
```

两个关键点：

- `ds-bot` 必须是 `file:` 而不是 `link:`——它的运行依赖（`playwright-core`、
  `imapflow` 等）要由 pnpm 装进 profile；`link:` 不会装依赖。
- `ds-bot` **不能**列进 `bundles`。它自己的 `cordis.patch.yml` 会插入同一个
  `bot` 行并带 web 专属覆盖；这一行由本包的补丁插入。

```bash
cd ~/.dsh/profiles/dsh-tui
pnpm install
```

### 3. 启动

```bash
dsh --profile dsh-tui
/bots
```

## 使用

```
↑/↓      选择                    Enter   进入该 Bot 的聊天
m        不离开面板发消息          c       新建 Bot（名称,角色）
s        停止该 Bot 当前的回合      x       删除（连按两次）
n        建 Chief（空团队时）      r       重读 state.json
q / Esc  返回聊天
```

每行显示实时状态：`工作中 Ns`（回合在跑）、`待回答`（有卡片等你）、`空闲`、
`●新`（你上次打开后它回了话）、`当前`（终端正在聊的 Bot）。

团队为空时按 `n`：用**终端能真正调用的模型路由**创建第一位 Main Bot「Chief」
并落盘。Chief 的开场白会作为一轮普通 Bot 回合直接出现在聊天里。之后的建 Bot、
拉群、交接都交给 Chief——在聊天里说就行，它用自己的团队工具完成。

`m` 不切屏就能给 Bot 派活：空闲的 Bot 会被挂载、收到消息、再挂起；正在工作的
Bot 则排队。面板持续刷新，你可以连着给几个 Bot 派活。

## 关于那一行 DS Bot 补丁

`patches/ds-bot-expose-runtime.patch` 在 `ds-bot/index.js` 加四行：

```js
if (typeof ctx.provide === 'function') ctx.provide('dsBot', rt)
```

DS Bot 的 `apply()` 目前把运行时对象丢掉了，别的插件拿不到 `createBot()` /
`bootstrap()`。把它发布成 cordis 服务，是让另一个前端共享同一份运行时所需的最小
改动；Web API 仍然在同一进程里调用，行为不变。

- **不打补丁**：`/bots` 列表和聊天照常，只是终端里不能建团队（`n` 不可用）。
- **打补丁**：终端可以创建第一位 Main Bot。
- 上游 PR 待提。不想带本地补丁，可以等这个服务合并，或用 `patch-package` 管理。

## 终端渲染

`patches/dsh-tui-transcript.patch` 是打在 dsh-TUI 0.19.0 上的定点补丁，只动四个
文件：

- **助手消息**去掉行首的大圆点 `⏺`，保留两列缩进
- **工具结果**去掉 `⎿` 转角符号，改成空白缩进
- **工具状态**保留错误 `✗`，但运行中/已结束不再画圆点
- **代码块**换成主题强调色的边框/竖线 + 浅背景，并默认走 hybrid 引擎，折行后
  竖线仍然连续

```bash
cd dsh-TUI
git apply /path/to/dsh-bot-tui/patches/dsh-tui-transcript.patch
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm compile
```

然后把 profile 指向这份构建：保留已安装包的 `node_modules`（里面有 dsh-TUI
自己的 React/marked/vendor 依赖），只替换代码文件。本机用的是：

```bash
P=~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui
mv "$P" "$P.orig"
cp -R /path/to/dsh-TUI "$P"
mv "$P.orig/node_modules" "$P/node_modules"
```

回滚：`mv "$P.orig" "$P"`；在 profile 里重跑 `pnpm install` 也会装回官方版。

补丁改的是 MIT 许可的 dsh-TUI 源码；本仓库只保存 diff，不复制其代码。

## 工作原理

```
dsh --profile dsh-tui（单进程）
├─ @deepseek-ai/dsh-base            DSH 内核：sessions、agents、tools、llm
├─ @deepseek-harness-tui/dsh-tui    终端：Chat、场景、命令、channel
└─ dsh-bot-tui 的 bundle 补丁
   ├─ bot-connection    connection 桩（无 HTTP）
   ├─ bot-controller    sessionController（基于 ctx.agents）
   ├─ bot               ds-bot 宿主运行时（人格、记忆、团队工具）
   └─ bot-tui           /bots 场景与命令
```

在某个 Bot 上按 `Enter`，会调用 `channel.resumeTo(bot.sessionId)`。Bot 的会话
就是普通 DSH 会话，所以 dsh-TUI 正常回放历史，下一条消息走常规 agent loop；
因为 DS Bot 宿主就在同一进程里、按会话身份决定人格与工具作用域，这一轮自然拿到
Bot 的人格、记忆和团队工具。

列表直接读 `$DSH_HOME/bot/state.json`。这是安全的：DS Bot 在自己的锁下用临时
文件 + rename 落盘，读者只会看到完整的某一版。

## 已知限制

- **只有终端开着，Bot 才会跑。** DS Bot 的网页/桌面宿主是常驻服务；这个插件
  把同一套运行时跑在 TUI 进程里。关掉终端，所有进行中的回合都会结束。想要真正
  常驻，就让 TUI 一直开着，或用 DS Bot 自己的桌面端。
- **一个团队同一时间只能有一个写者。** DS Bot 桌面端/网页端与本终端共用
  `$DSH_HOME/bot`。另一个宿主持锁时，TUI 这边变只读：列表顶部有提示，回合可能
  不落盘。先关掉另一边。
- **没有专门的群聊、审批、记忆、模型管理界面**，这些仍走 Bot 对话与卡片。
- **`page()` 目前是空实现**，返回空页：交接备注与记忆回读会退化，普通聊天不受
  影响。
- **建团队需要上面那行补丁**。
- 列表打开时每秒轮询一次 `state.json`，不是推送。

## 开发

```bash
node --check src/index.js src/scene.js src/controller.js src/connection.js
dsh --profile dsh-tui          # 启动检查：不应出现 "did not activate"
/bots                          # 冒烟：列表能渲染，Enter 能进聊天
```

改过 DS Bot 宿主代码后，刷新 profile 里的 `file:` 副本：

```bash
cd ~/.dsh/profiles/dsh-tui && pnpm install --force
```

目录：

```
src/index.js       cordis 插件入口：/bots 命令与场景注册
src/scene.js       TeamScene：列表、按键、resumeTo、建 Chief
src/controller.js  sessionController 适配器（基于 ctx.agents）
src/connection.js  connection 服务桩
cordis.patch.yml   本 bundle 插入的 profile 行
patches/           上游 DS Bot 补丁
```

目前没有自动化测试；验证方式就是上面的启动检查加 `/bots` 冒烟。欢迎补一套无头
回归。

## 许可证与致谢

Apache-2.0，见 [LICENSE](LICENSE)。

- [DS Bot](https://github.com/Fei2411/DS-Bot) —— © 2026 Fei2411 与 DS Bot
  贡献者，Apache-2.0。Bot 身份、记忆、工具与宿主运行时归他们；本仓库只把传输
  层换成进程内。
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) —— © 2026 chimney，MIT。
  终端 UI、场景/命令接缝与 `channel` 归他们；本仓库没有修改它。
- 本仓库没有复制任何第三方源码。
