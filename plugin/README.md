# escape.fm for Claude Code

Background music that follows your work. While Claude Code runs, this plugin tells
the [escape.fm](https://escape.fm) player two things about each session, and whether
Claude's steps are going through, and the player picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether Claude Code reports it as failed (`PostToolUseFailure`). Never what the step was. Left out when there are none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`Bash`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder you work in. Never a file name, a commit message or a diff |
| `usage` | `{"tokens": 0, "cost": 0.42}` | **Only if you have switched on "Tokens and cost" and set up the status line (below).** The session's cost in US dollars since the last report, as Claude Code estimates it; tokens are always 0, since Claude Code tells a status line only its last answer's |

When the session ends, one last report says so: `session`, `ts` and `end: true`, so its
state is removed at once rather than after half an hour.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (claude-code)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run).

Nothing else. Your prompt is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths
and outputs are not read at all; only tool names are, and of `Bash` its command, only to
tell a test run or a commit from any other command (`stepOf`, in the same file). They
stay local. Whether a step failed is told by which event Claude Code runs, not by
anything the tool returned. The folder you work in is used only to run git there, when
you have switched on "Lines of code".

## How the tags are chosen

| Claude Code event | Agent state |
| --- | --- |
| You submit a message | `user` |
| A tool starts or finishes | `running` |
| A permission prompt, a question to you, a plan awaiting approval | `waiting` |
| Claude stops | `idle` |
| The session ends | the session is removed |

| Claude Code event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`PostToolUse`) | `true` |
| It fails (`PostToolUseFailure`) | `false` |
| Reading, searching, asking you, or a tool you stopped | none |

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

So that new versions arrive on their own, turn on auto-update for the marketplace:
`/plugin` → Marketplaces → escape-fm → Enable auto-update.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Pairing

On first use the plugin creates a random listener key in `~/.escape-fm/config.json`.
The player receives it through the URL fragment, which browsers never send to a
server, and keeps it in local storage. Anyone holding the key can see these tags,
so treat the pairing link as private. Delete `~/.escape-fm/config.json` to reset.

The key is shared with escape.fm for every other agent on the same machine
([`integrations/`](../integrations)), so one player hears them all.

## Tokens and cost (optional)

Claude Code tells its hooks nothing of what a session costs; it tells its status line. A
plugin cannot set up a status line, so if you have switched on "Tokens and cost" on your
page in escape.fm and want Claude Code's cost counted, set it up yourself:

```bash
node <this folder>/scripts/statusline.mjs --install
```

This copies [`scripts/statusline.mjs`](scripts/statusline.mjs) to
`~/.escape-fm/statusline.mjs` and prints the `statusLine` setting to add to
`~/.claude/settings.json`; it changes no settings itself. The setting replaces any status
line you already have. The status line shows the model and the session's cost so far
(`Opus · $0.42`). Of what Claude Code hands it, it reads only the session id, the cost
and the model's name; while "Tokens and cost" is on, it writes the cost to
`~/.escape-fm/usage/`, and the plugin sends how much it grew with its next report. To
stop, take the setting out again.

## Settings

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_COMPUTER_NAME` | The name sent as `computer` in place of this computer's own; set to nothing (`ESCAPE_FM_COMPUTER_NAME=`), no name is sent |
| `ESCAPE_FM_API`, `ESCAPE_FM_PLAYER` | Point at another relay or player, for development |
