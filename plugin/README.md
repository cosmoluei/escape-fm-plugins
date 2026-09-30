# escape.fm for Claude Code

Background music that follows your work. While Claude Code runs, this plugin tells
the [escape.fm](https://escape.fm) player two things about each session, and the
player picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |

Nothing else. Your prompt is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths
and outputs are not read at all; only tool names are, and they stay local.

## How the tags are chosen

| Claude Code event | Agent state |
| --- | --- |
| You submit a message | `user` |
| A tool starts or finishes | `running` |
| A permission prompt, a question to you, a plan awaiting approval | `waiting` |
| Claude stops | `idle` |
| The session ends | the session is removed |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
Claude then does decides: mostly edits is `deep`, only reading is `explore`.

Known gap: after you approve a permission prompt, Claude Code gives no signal
until the tool finishes, so a long approved command still shows as `waiting`
until it ends.

## Install

```bash
claude plugin marketplace add <this repository>
claude plugin install escape-fm@escape-fm
```

The first session after installing opens the player in your browser, already
paired with this machine. Press play there. To open it again later, run
`/escape-fm:open`.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Pairing

On first use the plugin creates a random listener key in `~/.escape-fm/config.json`.
The player receives it through the URL fragment, which browsers never send to a
server, and keeps it in local storage. Anyone holding the key can see these tags,
so treat the pairing link as private. Delete `~/.escape-fm/config.json` to reset.

The key is shared with escape.fm for [Codex](../integrations/codex/README.md) and for
[Cursor](../integrations/cursor/README.md) on the same machine, so one player hears
them all.

## Settings

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_API`, `ESCAPE_FM_PLAYER` | Point at another relay or player, for development |
