# dsh-bot-tui

[English](README.md) · [中文](README.zh.md)

**DS Bot's Bot team, in the terminal — built on [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI).**

`dsh-bot-tui` is a [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) plugin that
brings the Bot team from [DS Bot](https://github.com/Fei2411/DS-Bot) into a
terminal session. `/bots` opens a full-screen roster; `Enter` opens that Bot's
chat. The Bot keeps its identity, memory, model and team tools — the turn runs
on DS Bot's own runtime, inside the same DSH kernel as the terminal.

> Status: experimental. Verified against dsh-TUI 0.19.0, DSH 0.2.2-rc.1 and
> DS Bot 0.3.2. Not affiliated with the dsh-TUI or DS Bot maintainers.

---

## Built on dsh-TUI

This project is **not a fork of dsh-TUI** and does not modify it. It is a
third-party plugin that consumes dsh-TUI's public plugin seams:

| dsh-TUI seam | What this plugin does with it |
| --- | --- |
| `ctx.tuiScenes.register()` | Registers the `ds-bot-team` full-screen roster and its keyboard panels (settings, groups, approvals, schedules, memory) |
| `ctx.commands.register()` | Registers the `/bots` slash command that opens it |
| `TuiSceneProps.channel` | Reads `channel.provider` / `channel.model` to create a Bot on the terminal's live route, and calls `channel.resumeTo(sessionId)` to open a Bot's chat |

There is deliberately **no chat renderer here**. Entering a Bot calls
`channel.resumeTo()` and hands the terminal back to dsh-TUI's own Chat screen:
whatever you type is composed by dsh-TUI. The scene owns the roster and its
keyboard panels.

The transcript *chrome* is the one thing this repo does tune: see
[Terminal rendering](#terminal-rendering) for the four-file dsh-TUI patch that
drops the leading `⏺`/`⎿` glyphs and gives fenced code an accent frame. It is
optional — on stock dsh-TUI the plugin works unchanged.

The same rule applies to dsh-TUI's React contract: the scene uses the injected
`React` and `ui` kit from `TuiSceneProps`, so it runs on dsh-TUI's own React 19
reconciler. No second React, no private imports.

## Built on DS Bot

DS Bot ships the team as a DSH plugin plus a browser client. This package mounts
the **host** half in the TUI profile and adds the two services the browser half
would normally provide, so the Bot runtime works without a web server:

| Row | Role |
| --- | --- |
| `dsh-bot-tui/connection` | Provides the `connection` service DS Bot registers its `/api/bot` and `/api/bot/feed` routes on. The terminal has no HTTP server, so registration is kept in memory and the disposer contract is preserved. |
| `dsh-bot-tui/controller` | Provides `sessionController` on top of the local Agent registry: `create`, `selectModel`, `prompt`, `resolveAgent`, `page`. DS Bot calls these for Bot/group sessions, model moves, and deliveries. |
| `dsh-bot-tui` | The `/bots` command and roster scene described above. |

What stays DS Bot's: Bot identity, roster, persona and system prompt, memory,
cross-Bot messages, group chats, approvals, handoffs, schedules. What stays
DSH's: agent loop, tools, model routes, sessions. This repo adds neither.

## Install

Requirements: Node `^22.19` or `>=24`, a working `dsh` installation, and
`dsh-TUI` 0.19.x installed in a profile.

### 1. Get DS Bot and this plugin

```bash
git clone https://github.com/Fei2411/DS-Bot.git
git clone https://github.com/yuxin-2/dsh-bot-tui.git
```

Apply the one-row runtime patch so the terminal can own the DS Bot runtime
(see [The one-row DS Bot patch](#the-one-row-ds-bot-patch) below):

```bash
cd DS-Bot
git apply /path/to/dsh-bot-tui/patches/ds-bot-expose-runtime.patch
```

### 2. Add both to the TUI profile

Edit `~/.dsh/profiles/dsh-tui/package.json`:

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

Two details matter:

- `ds-bot` must be a `file:` dependency, not `link:` — its runtime dependencies
  (`playwright-core`, `imapflow`, …) have to be installed into the profile by
  pnpm. A `link:` would leave them missing.
- `ds-bot` must **not** be listed in `bundles`. Its own `cordis.patch.yml`
  inserts the same `bot` row and adds web-only overrides; this package's patch
  mounts the row instead.

```bash
cd ~/.dsh/profiles/dsh-tui
pnpm install
```

### 3. Run

```bash
dsh --profile dsh-tui
/bots
```

## Use

```
↑/↓      move                      Enter   open that Bot's chat
m        message without leaving    c      create a Bot (name,role,brief)
s        stop that Bot's turn       x      delete (press twice)
X        clear the selected failure
S        stop every working Bot (confirm first)
n        create Chief (empty team)  r      re-read state.json
/        search name or label       t      group chats
e        edit this Bot's settings   a      answer pending approvals
h        approval history (in the a panel)
p        approve pending MCPs       v      mount/unmount capabilities
u        release this terminal's claim
space    collapse/expand details
←/→      collapse/expand the selected group
PgUp/PgDn  detail history (older/newer)
?        help overlay
y        token usage for this Bot   o      Computer panel
q/Esc  back to the chat
```

`e` opens the Bot's settings as a keyboard form: name, label, avatar (shape or a
local image path), color, effort, permissions, instructions, model, working folder,
private/pinned/hidden, Main Bot, section, Computer access, memory, schedules,
duplicate, and delete. The model row lists every catalog entry and marks the one
that needs a key; the effort row lists the model's thinking levels; the permission
row lists the presets DSH offers (full access in red); the section
row moves the Bot between sidebar groups (`n` creates a new one); the Computer row
sets the Bot's access level (off/view/background/foreground); the Browser row
lists per-site grants (`n` adds one, `x` revokes the selected one). `t` lists
group chats: create one from a Bot checklist, open it, rename it, change members,
admin, reply mode, permission, folder, section, notice, memory, or schedules, and
delete it. `a`
answers DS Bot's pending approvals (`Enter` allow, `x` reject). `y` sums the
usage ledger by Bot; `d`/`w`/`m` narrow it to a day, a week or a month. `o` opens
the Computer panel: the global switch, provider retry, each Bot's level, and the
app grants that can be revoked.

The memory panel (`e` → Memory) is a two-way editor: `a` asks the keeper Bot to
add, edit or remove entries in plain language, `Enter` edits the selected entry
(Ctrl+Enter for a new line, Enter or Ctrl+S saves, Esc cancels), `p` pins or
unpins the selected entry, `l` moves it between the Bot's own memory and the
team's shared memory, `m` moves the selected entry to another Bot, group or the
team memory, `t` undoes the last tidy, and `x` forgets it. `h` opens the change
log; `Enter` restores a change, `n` loads older rows. Schedules support daily,
weekly (pick days 1–7), repeat-every, and one-shot times.

Rows show live state: `工作中 Ns` (a turn is running), `待回答` (a card is
waiting for you), `空闲`, `●新` (a reply arrived since you last opened it), and
`当前` for the Bot whose chat the terminal is on. `/` filters the roster by name
or label; `Esc` clears the filter before it leaves the scene.

On an empty team, `n` creates the first Main Bot, **Chief**, on a model route
this terminal can actually reach, and saves it. Chief's greeting runs as a
normal Bot turn and appears in the chat. Everything else (more Bots, groups,
handoffs) is Chief's job: ask it in the chat, and it uses its own team tools.

`m` sends to a Bot without switching the screen: an idle Bot is mounted, given
the message, and parked again; a working Bot queues it. The roster keeps
updating, so you can fire off work to several Bots in a row.

## The one-row DS Bot patch

`patches/ds-bot-expose-runtime.patch` adds four lines to
`ds-bot/index.js`:

```js
if (typeof ctx.provide === 'function') ctx.provide('dsBot', rt)
```

DS Bot's `apply()` discards the runtime object today, so no other plugin can
reach `createBot()` / `bootstrap()`. Publishing it as a cordis service is the
smallest change that lets a different front end share the same runtime; the web
API keeps working in-process.

- **Without the patch:** `/bots`, roster, and chatting still work; only creating
  a team from the terminal (`n`) is unavailable.
- **With the patch:** the terminal can create the first Main Bot.
- Upstream PR pending. If you prefer no local patch, wait for the service to
  land, or carry the patch with `patch-package`.

## Terminal rendering

`patches/dsh-tui-transcript.patch` is a focused patch against dsh-TUI 0.19.0.
It changes four files and nothing else:

- **assistant rows** lose the big leading `⏺` marker; the two-column gutter stays
- **tool-result rows** lose the `⎿` corner glyph (plain indentation instead)
- **tool status** keeps the error `✗`, but no longer paints a dot for running or
  settled calls
- **code fences** get an accent-colored frame/rail and a tinted body, and the
  hybrid frame engine is the default so the rail continues across wrapped code
  lines

```bash
cd dsh-TUI
git apply /path/to/dsh-bot-tui/patches/dsh-tui-transcript.patch
git submodule update --init --recursive
pnpm install --frozen-lockfile
pnpm compile
```

Then point the profile at that build: keep the installed package's
`node_modules` (it carries dsh-TUI's own React/marked/vendor deps) and replace
only the checked-in files. The local install used by this repo did:

```bash
P=~/.dsh/profiles/dsh-tui/node_modules/@deepseek-harness-tui/dsh-tui
mv "$P" "$P.orig"
cp -R /path/to/dsh-TUI "$P"          # lib/, assets/, presets/, tui-profile/, …
mv "$P.orig/node_modules" "$P/node_modules"
```

Roll back with `mv "$P.orig" "$P"`. Re-running `pnpm install` in the profile
restores the published package too.

The patch is MIT-licensed dsh-TUI source; it is not copied into this
repository, only carried as a diff.

## How it works

```
dsh --profile dsh-tui (one process)
├─ @deepseek-ai/dsh-base            DSH kernel: sessions, agents, tools, llm
├─ @deepseek-harness-tui/dsh-tui    terminal: Chat, scenes, commands, channel
└─ dsh-bot-tui bundle patch
   ├─ bot-connection    connection stub (no HTTP)
   ├─ bot-controller    sessionController on ctx.agents
   ├─ bot               ds-bot host runtime (persona, memory, team tools)
   └─ bot-tui           /bots scene + command
```

`Enter` on a Bot calls `channel.resumeTo(bot.sessionId)`. The Bot's session is a
normal DSH session, so dsh-TUI replays its transcript, and the next prompt goes
through the ordinary agent loop. Because the DS Bot host is live in the same
process and keys its prompt/tool scoping by session identity, that turn gets
the Bot's persona, memory and team tools.

The roster reads `$DSH_HOME/bot/state.json` directly. That is safe: DS Bot saves
with a temp-file rename under its own lock, so a reader sees a complete revision.

## Limitations

- **Bots only run while the terminal is open.** DS Bot's web/desktop host is a
  long-lived server; this plugin runs the same runtime inside the TUI process.
  Closing the terminal ends every running turn. For truly always-on Bots, keep
  the TUI open (or use DS Bot's own desktop app).
- **One writer per team.** DS Bot's desktop/web app and this terminal share
  `$DSH_HOME/bot`. While another host holds the lock, the TUI host goes
  read-only: the roster shows a warning and turns may not persist. Close the
  other app first.
- **One terminal per session.** A TUI process keeps its session claims until
  it exits. Closing the outer window inside tmux/byobu does not exit
  `dsh-tui`, so the session stays occupied and a new window is refused with
  "mounted by another TUI terminal (pid …)". Exit that process (Ctrl+D) or
  `kill <pid>`; in the roster, `u` releases a background session this terminal
  still holds, and a Bot held elsewhere shows `他窗:<pid>`.
- **Group, approval and memory screens are keyboard-driven.** They cover
  create/open/edit/delete for groups, allow/reject for approvals, and
  view/forget for memory; the browser's drag-and-drop member cards and memory
  ask/edit/tidy tools are not reproduced.
- **The settings form is keyboard-first.** It covers profile, avatar (a shape or
  a local image path), color, effort, permissions, instructions, model, folder,
  privacy, pin/hide, Main Bot, section, Computer access, browser grants, memory,
  schedules, duplicate and delete. The Computer panel (`o`) toggles the global switch,
  retries the provider, and revokes app grants; browser grants can also be added by hand
  (site plus post/upload/download/delete/*). Permission presets come from DSH's
  `permissionPresets` service; without it the row shows the default and Enter
  reports that no presets are available.
- **Group management is a checklist.** Creating or editing members uses a Bot
  checklist (2–12 members); the browser's drag-and-drop and per-member cards are
  not reproduced. Group settings also cover permission, section, notice, memory and
  schedules.
- **Memory is ask, pin, layer, move, edit and forget.** The panel also undoes
  the last tidy and restores rows from the change log; editing one entry is
  composed from the ask and forget endpoints, since DS Bot has no single-entry
  write endpoint. The browser's separate tidy queue is not reproduced; it runs
  on its own inside DS Bot.
- **History pages read the durable Session log.** `page()` pages the stored
  log through the persistence seam, read-only; a missing or empty log returns
  an empty page, so handoff notes and memory read-back degrade instead of
  failing the turn.
- **The patch above** is required for creating a team from the terminal.
- The roster watches `$DSH_HOME/bot` for `state.json` changes (120 ms debounce)
  and falls back to polling every 1.5 s on filesystems that cannot watch.

## Development

```bash
node --check src/index.js src/scene.js src/controller.js src/connection.js
dsh --profile dsh-tui          # boot check: no "did not activate" warnings
/bots                          # smoke: roster, e settings, t groups, a approvals
```

After editing DS Bot's host code, refresh the profile's `file:` copy:

```bash
cd ~/.dsh/profiles/dsh-tui && pnpm install --force
```

Layout:

```
src/index.js       cordis plugin entry: /bots command + scene registration
src/scene.js       TeamScene: roster, key handling, resumeTo, create Chief
src/controller.js  sessionController adapter on ctx.agents
src/connection.js  connection service stub
cordis.patch.yml   profile rows inserted by this bundle
patches/           the upstream DS Bot patch
```

```bash
# from the repo root
pnpm install
pnpm test           # node --check + headless probes
```

## License and credits

Apache-2.0. See [LICENSE](LICENSE).

- [DS Bot](https://github.com/Fei2411/DS-Bot) — © 2026 Fei2411 and the DS Bot
  contributors, Apache-2.0. Bot identity, memory, tools and the host runtime are
  theirs; this repo only adapts the transport for a terminal.
- [dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) — © 2026 chimney, MIT. The
  terminal UI, scene/command seams and `channel` are theirs; this repo does not
  modify it.
- No third-party source code is copied into this repository.
