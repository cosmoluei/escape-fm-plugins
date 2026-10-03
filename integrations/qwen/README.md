# escape.fm for Qwen Code

Background music that follows your work. While Qwen Code runs, this tells the
[escape.fm](https://escape.fm) player two things about each session, and whether its
steps are going through, and the player picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether Qwen Code reports it as failed (`PostToolUseFailure`). Never what the step was. Left out when there are none |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.5.0 (qwen-code)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, commands, file names,
paths, outputs and error messages are not read at all; only tool names are, and they
stay local. Qwen Code also hands every hook the transcript's path, the folder you work
in and the last thing it said; none of them is looked at.

The hooks never answer Qwen Code. They print nothing but the one welcome below, so they
cannot allow, deny or change anything the agent does, and nothing they print reaches
the model.

## How the tags are chosen

| Qwen Code event | Agent state |
| --- | --- |
| You submit a message (`UserPromptSubmit` with `submitted_prompt`) | `user` |
| A tool starts or finishes (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`) | `running` |
| A permission prompt (`PermissionRequest`, `Notification`), or a question to you (`ask_user_question`) | `waiting` |
| Qwen Code finishes its turn (`Stop`), or an error ends it (`StopFailure`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

| Qwen Code event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`PostToolUse`) | `true` |
| It fails (`PostToolUseFailure`), a command that exits with an error included | `false` |
| Reading, searching, asking you, or a tool you stopped | none |

Qwen Code runs `UserPromptSubmit` before every call to the model, also when it hands the
model a tool's result. Only one that carries `submitted_prompt`, which Qwen Code sets for
what you typed, is your message; the others are not read.

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps:

- **Stopping a turn runs no hook** (`Stop` is skipped when you interrupt), so the
  session keeps showing `running` until your next message or until Qwen Code closes.
- A search command that finds nothing (`grep` exiting with 1) is not a failure to Qwen
  Code, and so not to this.
- Qwen Code runs ten background hooks at most at once and skips the rest, so a very
  busy moment can miss a step.

This was written from Qwen Code's documentation and checked with events in the
documented shape, not yet against a running Qwen Code.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/qwen/install.mjs
```

This copies the hook scripts to `~/.escape-fm/qwen` and adds the hooks to
`~/.qwen/settings.json`, beside everything else in it. Start Qwen Code again to pick
them up; `/hooks` lists them. `--print` shows the settings instead of writing them, if
you would rather add them yourself.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/qwen/open.mjs
```

This folder also carries a `qwen-extension.json`, so it can be tried as a Qwen Code
extension; that has not been tried.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Uninstall

```bash
node integrations/qwen/install.mjs --uninstall
```

takes the escape.fm entries out of `settings.json`, leaves everything else in it as it
was, and removes `~/.escape-fm/qwen`.

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
