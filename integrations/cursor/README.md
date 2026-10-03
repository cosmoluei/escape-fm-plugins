# escape.fm for Cursor

Background music that follows your work. While Cursor's agent runs, this tells the
[escape.fm](https://escape.fm) player two things about each conversation, and the
player picks and shapes the music from them.

## What leaves your machine

Per conversation, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the conversation id, so several conversations can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether Cursor reports it as failed (`postToolUseFailure`). Never what the step was. Left out when there are none |

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.5.0 (cursor)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

Nothing else. Your prompt is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, commands, file names,
paths, outputs and error messages are not read at all; only tool names are, and they
stay local. Whether a step failed is told by which event Cursor runs, and whether it
was denied by its failure type, not by anything the tool returned.
Cursor also hands every hook your account's email address, the workspace folders and
the transcript's path; none of them is looked at.

The hooks never answer Cursor. They print nothing, so they cannot allow, deny or
change anything the agent does.

## How the tags are chosen

| Cursor event | Agent state |
| --- | --- |
| You send a message (`beforeSubmitPrompt`) | `user` |
| A tool starts, finishes or fails (`preToolUse`, `postToolUse`, `postToolUseFailure`) | `running` |
| The agent stops, or you stop it (`stop`) | `idle` |
| The conversation ends (`sessionEnd`) | the session is removed |

| Cursor event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`postToolUse`) | `true` |
| It fails or times out (`postToolUseFailure`) | `false` |
| Reading, searching, asking you, a tool you stopped or did not allow | none |

Whether a shell command that exits with an error counts as a failure in Cursor's
events is not documented.

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the conversation already had; if there was none,
what the agent then does decides: mostly edits is `deep`, only reading is `explore`.

A conversation is first reported when you send its first message, not when it is
opened. (`sessionStart` is listened to for one thing: opening the player the first
time, when this was installed as a plugin.)

Known gaps:

- **Cursor has no event for an approval prompt.** While it waits for you to allow a
  command, the conversation shows as `running`, not `waiting`. This is the state
  Cursor cannot tell a hook.
- A question the agent asks you shows as `waiting` only if Cursor reports its
  question tool to hooks under the name `AskQuestion`, which its documentation does
  not say.
- Cloud agents do not load the hooks in `~/.cursor/hooks.json`, so they are not
  heard. Tab completions are not the agent and are not reported.

This was written from Cursor's documentation and checked with events in the
documented shape, not yet against a running Cursor.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of this repository:

```bash
node integrations/cursor/install.mjs
```

This copies the hook scripts to `~/.escape-fm/cursor` and adds the hooks to
`~/.cursor/hooks.json`, beside any you already have. Cursor picks them up without a
restart; they are listed under **Customize**, in the Hooks tab. `--project` installs
into the project you are in (`.cursor/hooks.json`) instead, and `--print` shows the
entries instead of writing them, if you would rather add them yourself.

The first time, the installer opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/cursor/open.mjs
```

This folder is also a Cursor plugin. To try it as one, copy the folder to
`~/.cursor/plugins/local/escape-fm` and reload the window, or start the CLI with
`agent --plugin-dir integrations/cursor`. It is not in the Cursor Marketplace.

The Cursor CLI (`agent`) reads the same `hooks.json`, so the same install covers it.
Which of these events the CLI runs has not been confirmed.

Requires Node 18 or later on the `PATH` that Cursor gives its hooks. Uses `curl` when
present, so proxy settings from your environment are honoured.

## Uninstall

```bash
node integrations/cursor/install.mjs --uninstall
```

takes the escape.fm entries out of `hooks.json`, leaves everything else in it as it
was, and removes `~/.escape-fm/cursor`. Add `--project` if that is how it was
installed.

## Pairing

On first use the integration creates a random listener key in
`~/.escape-fm/config.json`. The same key is used by escape.fm for every other agent
on this machine, so one player hears them all. The player receives it through
the URL fragment, which browsers never send to a server, and keeps it in local
storage. Anyone holding the key can see these tags, so treat the pairing link as
private. Delete `~/.escape-fm/config.json` to reset.

## Settings

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_COMPUTER_NAME` | The name sent as `computer` in place of this computer's own; set to nothing (`ESCAPE_FM_COMPUTER_NAME=`), no name is sent |
| `ESCAPE_FM_API`, `ESCAPE_FM_PLAYER` | Point at another relay or player, for development |

Set them in the environment Cursor is started from. `install.mjs` reads
`ESCAPE_FM_HOME` too, and the hooks it writes point at the folder it copied to.
