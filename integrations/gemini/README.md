# escape.fm for Gemini CLI

Background music that follows your work. While Gemini CLI runs, this tells the
[escape.fm](https://escape.fm) player two things about each session, and whether its
steps are going through where Gemini CLI says, and the player picks and shapes the
music from them.

## What leaves your machine

Per session, on hook events:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: an edit or an MCP tool, from whether Gemini CLI marks its result as an error. Never what the step was. Left out when there are none |
| `steps` | `{"edit": 3, "test": 1}` | How many of the agent's steps since the last report were of each kind: `edit`, `command`, `test`, `search` (reading), `commit` or `other`, counted when a tool finishes. A command run in the shell (`run_shell_command`) is told apart as a test run or a commit from its command, on this machine; the command itself is never sent or kept. Left out when there were none |
| `lines` | `{"added": 120, "removed": 14, "commits": 1}` | **Only if you have switched on "Lines of code" on your page in escape.fm.** At the end of a turn, the lines added and removed and the commits made since the last report, counted with git in the folder you work in. Never a file name, a commit message or a diff |

When the session ends, one last report says so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.6.0 (gemini-cli)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

`lines` and `usage` are off until you switch them on, on your page in escape.fm ("Lines of
code", "Tokens and cost", under the history section). escape.fm's answer to each report says
which are on, and the plugin keeps that in `~/.escape-fm/share.json`; while one is off, nothing
of it is counted, kept or sent (for lines, git is not even run). Gemini CLI tells a hook its tokens only together with the conversation, which is not read, so it sends no `usage`.

Nothing else. Your message is read locally to choose the work mode
([`scripts/classify.mjs`](scripts/classify.mjs), a short keyword list you can read
in a minute) and is never sent, stored or logged. Tool inputs, file names, paths,
outputs and error messages are not read at all; only tool names are, of
`run_shell_command` its command, only to tell a test run or a commit from any other
command ([`scripts/classify.mjs`](scripts/classify.mjs), `stepOf`), and of a tool's
result only whether it carries an error. Gemini CLI also hands every hook the
transcript's path and the folder you work in, and at the end of a turn its answer; none
of them is looked at, except the folder, to run git there when you have switched on
"Lines of code".

The hooks never answer Gemini CLI. They print nothing but the one welcome below, so
they cannot allow, deny or change anything the agent does.

## How the tags are chosen

| Gemini CLI event | Agent state |
| --- | --- |
| You submit a message (`BeforeAgent`) | `user` |
| A tool starts or finishes (`BeforeTool`, `AfterTool`) | `running` |
| A permission prompt (`Notification`, `ToolPermission`), or a question to you (`ask_user`) | `waiting` |
| Gemini CLI finishes its turn (`AfterAgent`) | `idle` |
| The session ends (`SessionEnd`) | the session is removed |

| Gemini CLI event | Outcome |
| --- | --- |
| An edit or an MCP tool finishes (`AfterTool`) without an error | `true` |
| Any step whose result carries an error: an edit that did not apply, a command that could not run | `false` |
| A shell command that ran, whatever its exit code; reading, searching, asking you | none |

The work mode comes from keywords in your message. A message with no hint
("continue", "ok") keeps the mode the session already had; if there was none, what
the agent then does decides: mostly edits is `deep`, only reading is `explore`.

Known gaps, all of them things Gemini CLI gives a hook no event or field for:

- **A shell command that fails** is not marked as an error: its exit code is only in
  the text the model is given, which is not read. So commands are no outcome, and a
  run of failing tests does not count; edits that do not apply do.
- **Stopping a turn, or an error ending it,** runs no hook (`AfterAgent` runs only when
  a turn completes), so the session keeps its last state until your next message.
- `BeforeTool` runs before Gemini CLI asks for approval; the permission prompt then
  shows as `waiting`, and the answer as nothing until the tool finishes.

This was written from Gemini CLI's documentation and source and checked with events in
the documented shape, not yet against a running Gemini CLI.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

As an extension, from a checkout of the escape.fm plugins repository:

```bash
gemini extensions install ./integrations/gemini
```

Gemini CLI copies the folder, shows the hooks it brings and asks you to confirm. Start
Gemini CLI again to pick them up; `/hooks panel` lists them. `gemini extensions update
escape-fm` takes a newer version from the checkout.

Or, to keep the hooks in your own settings instead:

```bash
node integrations/gemini/install.mjs
```

This copies the hook scripts to `~/.escape-fm/gemini` and adds the hooks to
`~/.gemini/settings.json`, beside everything else in it (`--print` shows them instead,
`--uninstall` takes them out again). Gemini CLI skips the hooks in settings in a folder
it does not trust; an extension's hooks it runs anyway.

The first session afterwards opens the player in your browser, already paired with
this machine. Press play there. To open it again later, `node open.mjs` in the
extension's folder (`~/.gemini/extensions/escape-fm`) or in `~/.escape-fm/gemini`.

Requires Node 18 or later. Uses `curl` when present, so proxy settings from your
environment are honoured.

## Uninstall

```bash
gemini extensions uninstall escape-fm
```

or, if installed into the settings, `node integrations/gemini/install.mjs --uninstall`.

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
