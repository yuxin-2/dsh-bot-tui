// DS Bot in dsh-TUI.
//
// The DS Bot host plugin runs on its own row (`bot`, mounted by this bundle's
// patch), so a Bot Session opened here is the same Session the Bot runs in the
// browser: its persona, memory and team tools come from that runtime, keyed by
// session identity. This row adds the terminal surface:
//
//   /bots  →  a full-screen team roster  →  Enter  →  resumeTo(bot.sessionId)
//
// The Chat screen underneath does the rendering and input; the scene is a
// roster plus a few fleet actions (message, create, stop, delete), so no
// transcript is duplicated and no second agent is created.
import { install as installActivity } from './activity.js'
import { TeamScene, bindRuntime } from './scene.js'

export const name = 'dsh-bot-tui'

/** Both services always exist in a composed dsh-tui profile; inject keeps the
 *  activation honest if an older host composes only part of the surface. */
export const inject = ['commands', 'tuiScenes']

const SCENE_ID = 'ds-bot-team'

export function apply(ctx) {
  // `ctx.get(name, fallback)` returns the fallback when the service is absent;
  // `false` is falsy but not undefined, and every "runtime not ready" check
  // would miss it and then call a method on `false`.
  bindRuntime(() => ctx.get('dsBot') ?? undefined)
  installActivity(ctx)

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
