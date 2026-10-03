# escape.fm for WorkBuddy

Background music that follows your work. While WorkBuddy, Tencent's desktop work agent,
runs a task, this tells the [escape.fm](https://escape.fm) player two things about it,
and whether its steps are going through, and the player picks and shapes the music from
them.

WorkBuddy runs CodeBuddy Code inside it, with the same hooks, so this folder's hook
script and hooks are [CodeBuddy's](../codebuddy/README.md), copied as they are; only the
name it reports under and where it is installed differ.

## What leaves your machine

Per task, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the task's session id, so several tasks can be told apart |
| `mode` | `ideate` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or a connector's tool, from whether WorkBuddy reports it as failed (`PostToolUseFailure`). Never what the step was. Left out when there are none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`Bash`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder WorkBuddy works in. Never a file name, a commit message or a diff |

When the task's session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (workbuddy)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run). WorkBuddy tells a hook nothing of tokens or cost, so it sends no `usage`.

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. What the tools are given and return,
your documents, file names and paths, are not read at all; only tool names are, and of
`Bash` its command, only to tell a test run or a commit from any other command
([`scripts/classify.mjs`](scripts/classify.mjs), `stepOf`). They stay local. The folder
WorkBuddy works in is used only to run git there, when you have switched on "Lines of
code".

The hooks never answer WorkBuddy, so they cannot allow, deny or change anything it does,
and nothing they print reaches the model.

## How the tags are chosen

As for CodeBuddy Code: your message is `user`, a tool starting or finishing is `running`,
a permission prompt or a question to you is `waiting`, the end of the turn is `idle`, and
a step that WorkBuddy reports as failed (`PostToolUseFailure`) is `false`. Reading and
searching, asking you, and a tool you stopped are no outcome.

Known gaps:

- WorkBuddy's own tools for office work are not documented by name. They count as steps
  (whether they went through is reported), and do not help choose the work mode, which
  comes from your message.
- **Stopping a task runs no hook**, so it keeps showing `running` until your next message.
- The events were seen working in the desktop app by others (sources in
  [docs/integrations.md](../../docs/integrations.md)); this integration was checked only
  with events in the documented shape, not yet against a running WorkBuddy.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/workbuddy/install.mjs
```

This copies the hook scripts to `~/.escape-fm/workbuddy` and adds the hooks to
`~/.workbuddy/settings.json` (or `$WORKBUDDY_CONFIG_DIR/settings.json`), beside
everything else in it. WorkBuddy reads its hooks only when it starts: quit it completely
and open it again. `--print` shows the settings instead of writing them.

The first task afterwards opens the player in your browser, already paired with this
machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/workbuddy/open.mjs
```

Requires Node 18 or later on the `PATH` WorkBuddy runs hooks with. Uses `curl` when
present, so proxy settings from your environment are honoured.

## Uninstall

```bash
node integrations/workbuddy/install.mjs --uninstall
```

takes the escape.fm entries out of `settings.json`, leaves everything else in it as it
was, and removes `~/.escape-fm/workbuddy`.

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
