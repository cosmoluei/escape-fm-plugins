# escape.fm for GitHub Copilot CLI

Background music that follows your work. While Copilot CLI runs, this tells the
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
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit or an MCP tool, from whether Copilot CLI reports it as failed (`postToolUseFailure`). Never what the step was. Left out when there are none |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.5.0 (copilot-cli)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool arguments, commands, file names,
paths, results and error messages are not read at all; only tool names are, and they
stay local. Copilot CLI also hands every hook the folder you work in and the
transcript's path; neither is looked at.

The hooks never answer Copilot CLI. They print nothing, so they cannot allow, deny or
change anything the agent does.

## How the tags are chosen

| Copilot CLI event | Agent state |
| --- | --- |
| You submit a message (`userPromptSubmitted`) | `user` |
| A tool finishes or fails (`postToolUse`, `postToolUseFailure`) | `running` |
| A permission prompt, or a question to you (`notification`: `permission_prompt`, `elicitation_dialog`) | `waiting` |
| Copilot finishes its turn (`agentStop`) | `idle` |
| The session ends (`sessionEnd`) | the session is removed |

| Copilot CLI event | Outcome |
| --- | --- |
| A command, an edit or an MCP tool finishes (`postToolUse`) | `true` |
| It fails (`postToolUseFailure`) | `false` |
| Reading, searching, asking you | none |

**No hook runs before a tool.** Copilot CLI denies a tool when a `preToolUse` hook fails
to run (no `node` on the `PATH`, say), and a music plugin must never stop the work. So a
tool is heard of when it finishes: until the first one does, a turn shows as you typing.

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps:

- Whether a shell command that exits with an error is a failure (`postToolUseFailure`)
  or a success whose output says so is not documented.
- **Stopping a turn** runs no documented hook, so the session keeps showing `running`
  until your next message or the session's end.
- In `copilot -p`, the session ends after each prompt.
- The cloud agent reads hooks only from a repository's `.github/hooks`, and is not heard.
- VS Code reads the same folder of hook files but names its events differently; whether
  it runs these is not known. It is not counted on.

This was written from Copilot CLI's documentation and checked with events in the
documented shape, not yet against a running Copilot CLI.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

From a checkout of the escape.fm plugins repository:

```bash
node integrations/copilot/install.mjs
```

This copies the hook scripts to `~/.escape-fm/copilot` and writes a hook file of its
own, `~/.copilot/hooks/escape-fm.json` (in `$COPILOT_HOME/hooks` if that is set). Start
a new session to pick it up. `--print` shows the file instead of writing it.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later:

```bash
node ~/.escape-fm/copilot/open.mjs
```

This folder is also a Copilot CLI plugin (`plugin.json`, `hooks/hooks.json`);
`copilot plugin install escape-fm/plugins:integrations/copilot` installs it that way.
That has not been tried.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Uninstall

```bash
node integrations/copilot/install.mjs --uninstall
```

removes `escape-fm.json` and `~/.escape-fm/copilot`, and leaves your other hook files as
they are.

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
