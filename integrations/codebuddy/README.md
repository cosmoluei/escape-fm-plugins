# escape.fm for CodeBuddy Code

Background music that follows your work. While CodeBuddy Code, Tencent's coding agent,
runs, this tells the [escape.fm](https://escape.fm) player two things about each session,
and whether its steps are going through, and the player picks and shapes the music from
them.

WorkBuddy runs the same engine and the same hooks; its integration is
[`integrations/workbuddy/`](../workbuddy/README.md), with this folder's hook script.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether CodeBuddy reports it as failed (`PostToolUseFailure`). Never what the step was. Left out when there are none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`Bash`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder you work in. Never a file name, a commit message or a diff |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (codebuddy)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run). CodeBuddy tells a hook nothing of tokens or cost, so it sends no `usage`.

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths,
outputs and error messages are not read at all; only tool names are, and of `Bash` its
command, only to tell a test run or a commit from any other command
([`scripts/classify.mjs`](scripts/classify.mjs), `stepOf`). They stay local. CodeBuddy
also hands every hook the transcript's path, which is not looked at, and the folder you
work in, used only to run git there when you have switched on "Lines of code".

The hooks never answer CodeBuddy. They print nothing but the one welcome below, as a
message for you (`systemMessage`), so they cannot allow, deny or change anything the
agent does, and nothing they print reaches the model.

## How the tags are chosen

| CodeBuddy event | Agent state |
| --- | --- |
| You submit a message (`UserPromptSubmit`) | `user` (in plan mode, the work mode is `plan`) |
| A tool starts or finishes (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) | `running` |
| A permission prompt (`PermissionRequest`, `Notification`), a dialog asking you for input (`Notification`), or a question to you (`AskUserQuestion`) | `waiting` |
| CodeBuddy finishes its turn (`Stop`), or an API error ends it (`StopFailure`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

| CodeBuddy event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`PostToolUse`) | `true` |
| It fails (`PostToolUseFailure`) | `false` |
| Reading, searching, asking you, or a tool you stopped | none |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps:

- **Stopping a turn runs no hook** (`Stop` does not run when you interrupt), so the
  session keeps showing `running` until your next message or until CodeBuddy closes.
- Whether a shell command that exits with an error runs `PostToolUseFailure`, as it does
  in Claude Code, is not documented.
- CodeBuddy waits for every hook. Each one hands its report to a process of its own and
  returns in a few tens of milliseconds.

This was written from CodeBuddy's documentation and checked with events in the
documented shape, not yet against a running CodeBuddy.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/codebuddy/install.mjs
```

This copies the hook scripts to `~/.escape-fm/codebuddy` and adds the hooks to
`~/.codebuddy/settings.json` (or `$CODEBUDDY_CONFIG_DIR/settings.json`), beside
everything else in it. Start CodeBuddy again to pick them up; `/hooks` lists them.
`--print` shows the settings instead of writing them.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/codebuddy/open.mjs
```

This folder is also a CodeBuddy plugin (`.codebuddy-plugin/plugin.json`, hooks with
`${CODEBUDDY_PLUGIN_ROOT}`); that has not been tried. Do not add this repository as a
CodeBuddy marketplace: CodeBuddy reads Claude Code's `.claude-plugin/marketplace.json`
too, which offers the Claude Code plugin, and that one would report as Claude Code.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured. On Windows CodeBuddy runs hooks with Git Bash.

## Uninstall

```bash
node integrations/codebuddy/install.mjs --uninstall
```

takes the escape.fm entries out of `settings.json`, leaves everything else in it as it
was, and removes `~/.escape-fm/codebuddy`.

## Pairing

On first use the integration creates a random listener key in
`~/.escape-fm/config.json`. The same key is used by escape.fm for every other agent on
this machine, so one player hears them all. The player receives it through the URL
fragment, which browsers never send to a server, and keeps it in local storage. Anyone
holding the key can see these tags, so treat the pairing link as private. Delete
`~/.escape-fm/config.json` to reset.

## Settings

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_COMPUTER_NAME` | The name sent as `computer` in place of this computer's own; set to nothing (`ESCAPE_FM_COMPUTER_NAME=`), no name is sent |
| `ESCAPE_FM_API`, `ESCAPE_FM_PLAYER` | Point at another relay or player, for development |
