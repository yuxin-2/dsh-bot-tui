// `connection` is the DSH web transport service: a plugin registers HTTP
// routes on it and the web server serves them to the browser half.
//
// DS Bot's host side only uses it for its two client-facing routes
// (`POST /api/bot` and the `GET /api/bot/feed` event stream). A terminal has no
// browser half, so this shim keeps the same service contract — registration
// preserves the route objects and returns a disposer — without a server. The
// TUI side reads the Bot team and opens Bot sessions in-process instead.

export const name = 'bot-connection'

export function apply(ctx) {
  const routes = []
  const register = (route) => {
    routes.push(route)
    return () => {
      const at = routes.indexOf(route)
      if (at >= 0) routes.splice(at, 1)
    }
  }
  ctx.provide('connection', Object.freeze({
    fetch: Object.freeze({ register }),
    // Diagnostics for a future TUI surface that wants to know what was mounted.
    get routes() {
      return routes.slice()
    },
  }))
}
