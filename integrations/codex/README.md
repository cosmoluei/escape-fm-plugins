# escape.fm for Codex

Background music that follows your work. While Codex runs, this tells the
[escape.fm](https://escape.fm) player two things about each session, and the
player picks and shapes the music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.3.0 (codex)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

Nothing else. Your prompt is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, commands, patches,
file names, paths and outputs are not read at all; only tool names are, and they
stay local. Codex hands every hook the path of the session's transcript and the last
thing it said; neither is looked at.

## How the tags are chosen

| Codex event | Agent state |
| --- | --- |
| You submit a message (`UserPromptSubmit`) | `user` |
| A tool starts or finishes (`PreToolUse`, `PostToolUse`) | `running` |
| Codex is about to ask for approval (`PermissionRequest`), or asks you a question (`request_user_input`, `request_permissions`) | `waiting` |
| Codex finishes its turn (`Stop`), or you interrupt it (`Interrupt`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had, or `deep` if it had none;
if Codex then edits files more than once, the mode becomes `deep`.

A subagent's tools count as its parent session's. What the parent tells a subagent
is not your message and is not read.

Known gaps, all of them things Codex gives a hook no event for:

- After you approve a command, nothing is signalled until it finishes, so a long
  approved command still shows as `waiting` until it ends.
- A turn that ends in an error (the model could not be reached, a request was
  refused) signals nothing, so the session keeps showing `running` until your next
  message or until Codex closes.
- An MCP server asking you for input does not show as `waiting`.
- Web search runs no hook, so a turn that only searches shows as `user` until it ends.
- Codex reads files with shell commands, which are not looked into, so "only reading"
  cannot be told apart and never turns the mode to `explore`; only a keyword does.
- Codex runs `SessionEnd` when it closes normally, when you archive or delete an open
  conversation, or after 30 minutes idle. A Codex that is killed says nothing, and the
  relay drops the session by itself after 30 minutes.

Checked against Codex 0.158 (`codex exec`, and a session kept open over the app-server
protocol) with a stand-in model; the terminal interface itself has not been tried.
[docs/integrations.md](../../docs/integrations.md) has the research, what was seen and
what is still open.

## Install

As a plugin:

```bash
codex plugin marketplace add <this repository>
codex plugin add escape-fm@escape-fm
```

Or without the plugin system, from a checkout of this repository:

```bash
node integrations/codex/install.mjs
```

This copies the hook scripts to `~/.escape-fm/codex` and adds the hooks to
`~/.codex/hooks.json` (or `$CODEX_HOME/hooks.json`), beside any you already have.
`--print` shows the entries instead of writing them, if you would rather add them
yourself.

Either way, **Codex does not run a hook until you have approved it**: run `/hooks` in
Codex and trust the escape.fm entries. After an update that changes them, Codex asks
again.

The first time, the player opens in your browser, already paired with this machine:
when `install.mjs` runs, or with the plugin, at the first session after the hooks are
trusted. Press play there. To open it again later:

```bash
node ~/.escape-fm/codex/open.mjs
```

(From a plugin install, run `scripts/open.mjs` in this folder instead.)

Requires Node 18 or later on your `PATH`, and a Codex recent enough to have the
`SessionEnd` and `Interrupt` hooks. Uses `curl` when present, so proxy settings from
your environment are honoured.

## Uninstall

```bash
codex plugin remove escape-fm@escape-fm
```

or, if it was installed with `install.mjs`:

```bash
node integrations/codex/install.mjs --uninstall
```

which takes the escape.fm entries out of `hooks.json`, leaves everything else in it as
it was, and removes `~/.escape-fm/codex`.

## Pairing

On first use the integration creates a random listener key in
`~/.escape-fm/config.json`. The same key is used by escape.fm for Claude Code and for
Cursor on this machine, so one player hears them all. The player receives it through
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

Set them in the environment Codex is started from.
