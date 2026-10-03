# escape.fm for Factory Droid

Background music that follows your work. While Droid runs, this tells the
[escape.fm](https://escape.fm) player two things about each session, and the player
picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`Execute`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder you work in. Never a file name, a commit message or a diff |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

Droid sends no `outcomes`: it has no event for a step that failed (below).

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (droid)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run). Droid tells a hook nothing of tokens or cost, so it sends no `usage`.

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths and
outputs are not read at all; only tool names are, and of `Execute` its command, only to
tell a test run or a commit from any other command
([`scripts/classify.mjs`](scripts/classify.mjs), `stepOf`). They stay local. Droid also
hands every hook the transcript's path, which is not looked at, and the folder you work
in, used only to run git there when you have switched on "Lines of code".

The hooks never answer Droid. They print nothing, so they cannot allow, deny or change
anything the agent does, and nothing they print reaches the model.

## How the tags are chosen

| Droid event | Agent state |
| --- | --- |
| You submit a message (`UserPromptSubmit`) | `user` (in spec mode, the work mode is `plan`) |
| A tool starts or finishes (`PreToolUse`, `PostToolUse`) | `running` |
| A permission prompt or a dialog asking you for input (`Notification`), or a question to you (`AskUser`) | `waiting` |
| Droid finishes its turn (`Stop`), or you stop it (`Notification`, `idle_prompt`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps:

- **Whether a step failed.** Droid documents `PostToolUse` as running after a tool
  succeeds, and has no event for one that fails, so the music cannot tell when Droid
  keeps failing.
- A subagent's tools are counted only if Droid reports them under the session that
  started it; whether it does is not documented.

This was written from Droid's documentation and checked with events in the documented
shape, not yet against a running Droid.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/droid/install.mjs
```

This copies the hook scripts to `~/.escape-fm/droid` and adds the hooks to
`~/.factory/hooks.json`, beside any you already have; if you keep your hooks under
`hooks` in `~/.factory/settings.json` and have no `hooks.json`, it adds them there, since
a `hooks.json` would hide them. Start Droid again to pick them up; `/hooks` lists them.
`--print` shows the hooks instead of writing them.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/droid/open.mjs
```

This folder is also a Droid plugin, listed in the repository's
`.factory-plugin/marketplace.json`: `droid plugin marketplace add escape-fm/plugins`,
then install `escape-fm` from it in `/plugins`. That has not been tried.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Uninstall

```bash
node integrations/droid/install.mjs --uninstall
```

takes the escape.fm entries out of the file, leaves everything else in it as it was, and
removes `~/.escape-fm/droid`.

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
