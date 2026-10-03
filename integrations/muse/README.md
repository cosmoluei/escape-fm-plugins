# escape.fm for Muse Code

Background music that follows your work. While Muse Code, Meta's coding agent, runs, this
tells the [escape.fm](https://escape.fm) player two things about each session, and whether
its steps are going through, and the player picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether Muse Code reports it as failed (`PostToolUseFailure`). Never what the step was. Left out when there are none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`bash` or `powershell`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder you work in. Never a file name, a commit message or a diff |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (muse-code)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run). Muse Code tells a hook nothing of tokens or cost, so it sends no `usage`.

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths,
outputs and error messages are not read at all; only tool names are, and of `bash` and
`powershell` the command, only to tell a test run or a commit from any other command
([`scripts/classify.mjs`](scripts/classify.mjs), `stepOf`). They stay local. Muse Code
also hands every hook the folder you work in, used only to run git there when you have
switched on "Lines of code", and the model's name, which is not looked at.

The hooks never answer Muse Code. All but four run in the background (`async`), where
nothing they print counts; the session's start prints only the one welcome below
(`systemMessage`, shown to you, not to the model), and the end of a turn and of a session
print nothing. So they cannot allow, deny or change anything the agent does.

## How the tags are chosen

| Muse Code event | Agent state |
| --- | --- |
| You submit a message (`UserPromptSubmit`) | `user` (in plan mode, the work mode is `plan`) |
| A tool starts or finishes (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) | `running` |
| A tool waits for your approval (`PermissionRequest`, and `Notification` after six seconds), or a question to you (`request_user_input`) | `waiting` |
| Muse Code finishes its turn (`Stop`), or a failed model call ends it (`StopFailure`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

| Muse Code event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`PostToolUse`) | `true` |
| It fails or crashes (`PostToolUseFailure`) | `false` |
| Reading, searching, asking you | none |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps:

- **Stopping a turn with Escape.** Muse Code 1.4.0 added an `Interrupt` hook, which is not
  used yet: it is not in the hooks reference (written for 1.3.0), and a settings file with an
  event an older version does not know might not load. Until then a stopped turn keeps
  showing `running` until your next message.
- Whether a shell command that exits with an error is a failed tool call is not documented.
- A child agent's events come under a session of its own, which this does not follow.

This was written from Muse Code's documentation and checked with events in the
documented shape, not yet against a running Muse Code.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/muse/install.mjs
```

This copies the hook scripts to `~/.escape-fm/muse` and adds the hooks to your Muse Code
user settings, `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`),
beside everything else in them, so they run in every project without a `.muse/hooks.json`
in each. Muse Code reads them when a session starts: start a new one. `--print` shows the
settings instead of writing them.

Muse Code runs hooks with a cleared environment that keeps `PATH`, so `node` has to be on
the `PATH` of the shell you start Muse Code from.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/muse/open.mjs
```

Do not add this repository as a Muse Code marketplace: Muse Code reads Claude Code's
`.claude-plugin/marketplace.json` too, and would import the Claude Code plugin, whose
hooks (`command` with `args`) Muse Code skips.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Uninstall

```bash
node integrations/muse/install.mjs --uninstall
```

takes the escape.fm entries out of `settings.json`, leaves everything else in it as it
was, and removes `~/.escape-fm/muse`.

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

Muse Code passes hooks only a few variables (`HOME`, `PATH`, `USER`, `LANG`, …), so these
reach the hooks only from a managed configuration (`managed_hooks_env_vars`); the defaults
need none of them.
