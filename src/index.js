// DS Bot in dsh-TUI.
//
// The DS Bot host plugin runs on its own row (`bot`, mounted by this bundle's
// patch), so a Bot Session opened here is the same Session the Bot runs in the
// browser: its persona, memory and team tools come from that runtime, keyed by
// session identity. This row only adds the terminal surface:
//
//   /bots  →  a full-screen team list  →  Enter  →  resumeTo(bot.sessionId)
//
// The Chat screen underneath does the rendering and input; the scene is only a
// roster, so no transcript is duplicated and no second agent is created.
import { TeamScene, bindRuntime } from './scene.js'

export const name = 'dsh-bot-tui'

/** Both services always exist in a composed dsh-tui profile; inject keeps the
 *  activation honest if an older host composes only part of the surface. */
export const inject = ['commands', 'tuiScenes']

const SCENE_ID = 'ds-bot-team'

export function apply(ctx) {
  bindRuntime(() => ctx.get('dsBot', false))
  const disposeScene = ctx.tuiScenes.register({
    id: SCENE_ID,
    title: 'DS Bot team',
    component: TeamScene,
  }, ctx)
  ctx.effect(() => () => disposeScene())

  const disposeCommand = ctx.commands.register({
    name: 'bots',
    description: 'List the DS Bot team and open a Bot chat',
    handler: () => {
      const opened = ctx.tuiScenes.open(SCENE_ID)
      return opened
        ? { kind: 'success' }
        : { kind: 'error', text: 'ds-bot-tui: the team scene is not registered' }
    },
  })
  ctx.effect(() => () => disposeCommand())
}
