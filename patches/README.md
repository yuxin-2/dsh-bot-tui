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

## `dsh-tui-transcript.patch`

A four-file patch against dsh-TUI 0.19.0's transcript chrome: no leading `⏺`
on assistant rows, no `⎿` on tool results, no running/settled status dot, and
an accent-framed code block (hybrid engine by default, tinted body).

Apply from the dsh-TUI repository root, then `pnpm install && pnpm compile`:

```bash
git apply /path/to/dsh-bot-tui/patches/dsh-tui-transcript.patch
```

It is optional: without it the plugin works on stock dsh-TUI, just with the
original markers. The patch is a diff against MIT-licensed dsh-TUI source; the
code itself is not copied into this repository.
