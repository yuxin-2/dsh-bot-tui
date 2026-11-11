# patches

## `ds-bot-expose-runtime.patch`

Adds four lines to `ds-bot/index.js` (DS Bot 0.3.2) so the runtime object is
published as the cordis service `dsBot`. Without it a terminal front end can
list and chat with Bots, but cannot create the first Main Bot.

Apply from the DS Bot repository root:

```bash
git apply /path/to/dsh-bot-tui/patches/ds-bot-expose-runtime.patch
```

The change is upstreamable: the web API keeps calling the same runtime
in-process, and the browser half does not change.
