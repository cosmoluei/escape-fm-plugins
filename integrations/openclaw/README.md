# escape.fm for OpenClaw

Background music that follows your work. While OpenClaw, the open-source personal agent,
works on something you asked for, this tells the [escape.fm](https://escape.fm) player
two things about each conversation, and whether its steps are going through, and the
player picks and shapes the music from them.

OpenClaw runs no commands on its events. This is an OpenClaw plugin instead: it runs inside
the gateway, listens to the gateway's events, and hands each one, stripped to a few words,
to the same hook script the other agents' integrations run, in a process of its own.

## What leaves your machine

Per conversation, as the agent works:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the conversation's key (`agent:main:main`, `agent:main:telegram:direct:…`), so several conversations can be told apart |
| `mode` | `deep` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's Mac mini` | The name of the computer the gateway runs on, as its system settings have it, so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report succeeded or failed, oldest first: a command, an edit, a message sent, a browser action, from whether OpenClaw reports the tool's result as an error. Never what the step was. Left out when there are none |

When a conversation ends (`/new`, `/reset`, a daily or idle reset), one last report says
so: `session`, `ts` and `end: true`.

And one request header, the same on every report:

| Header | Example | What it is |
| --- | --- | --- |
| `User-Agent` | `escape-fm/0.5.0 (openclaw)` | Which integration sent the report and its version, so escape.fm can count how many machines use each integration. It names nothing about your machine or you |

From it the relay counts, once a day for each paired machine, that this integration
reported and how many reports it sent, with the country Cloudflare places the request
in (never the address). Those counts are all that is kept. How it is done is in [docs/analytics.md](../../docs/analytics.md).

Nothing else. **No message is read**, yours or anyone's, nor the agent's replies: the
plugin passes on only the conversation's key, what happened (a message arrived, a run
started or ended, a tool started or finished, an approval is pending), a tool's name and
whether it failed. So the work mode comes from what the agent does (mostly edits is `deep`,
only reading is `explore`), never from what was written, and is `deep` until the tools say
otherwise. Tool inputs, results, commands, file names and paths are not read, apart from
whether a result is an error.

The plugin answers no hook: it cannot allow, block or change anything the agent does.

## How the tags are chosen

OpenClaw is usually talked to from a chat app rather than at a desk, so "you typed" is a
message from you arriving.

| OpenClaw event | Agent state |
| --- | --- |
| A message arrives in a direct conversation (`message_received`) | `user` |
| A run starts (the `lifecycle` stream's `start`), a tool starts or finishes (`before_tool_call`, `after_tool_call`) | `running` |
| An approval is pending (`waiting-approval`, or an `approval` / `execution` event saying so), or the agent waits for your input | `waiting` |
| The run ends (`end` or `error`) | `idle` |
| The conversation ends (`session_end`) | the conversation is removed |

| OpenClaw event | Outcome |
| --- | --- |
| A tool other than reading finishes (`after_tool_call`) | `true`, or `false` when its result is an error |
| Reading, searching, fetching, memory lookups | none |

- A message in a group or a channel (a key with `:group:` or `:channel:`) is someone else
  writing, perhaps, and is not counted as you typing; the agent's work on it still is.
- The agent's own heartbeat runs are left out: nobody asked for them.
- In OpenClaw 2026.3, a command that waits for your approval returns at once and the run
  ends; the conversation stays `waiting` until the next run starts (after your `/approve`)
  or the conversation ends. Newer versions wait within the run.

Known gaps:

- **Telling you from other people in a direct conversation.** OpenClaw's message event
  says nothing of who the sender is to the agent; in a direct conversation it is taken to be
  you, as OpenClaw lets only paired or allowed senders talk to it there.
- **OpenClaw 2026.3 does not name the conversation in `message_received`**, so there a
  message is not heard, and the conversation goes straight to `running` as the run starts.
- A run made by a CLI backend (`claude-cli` and the like) runs no tool hooks in OpenClaw
  2026.3; only its start and end are heard.
- In newer versions `agent_end` needs a grant (`allowConversationAccess`) that this plugin
  does not ask for; the end of a run is taken from the event stream instead.

The plugin was installed into OpenClaw 2026.3.13 in a configuration of its own
(`openclaw plugins install --link`; `openclaw plugins info escape-fm` says it is loaded), and
a turn was run with `openclaw agent --local` against a stand-in model that called one tool:
the player heard `running`, then `idle` with the step's outcome. Its handling of the other
events was checked with events in the shape OpenClaw's documentation and source give; a
message from a chat app through a running gateway, and a current version, are still to try.
[docs/integrations.md](../../docs/integrations.md) has the research and what is still
to be confirmed.

## Install

On the machine the gateway runs on, as the user it runs as, from a checkout of the
escape.fm plugins repository:

```bash
node integrations/openclaw/install.mjs
openclaw gateway restart
```

The first copies the plugin to `~/.escape-fm/openclaw` and runs
`openclaw plugins install --link ~/.escape-fm/openclaw`, which adds that folder to the
plugins OpenClaw loads (`plugins.load.paths` and `plugins.entries.escape-fm` in
`~/.openclaw/openclaw.json`). `--print` copies the plugin and shows the command instead of
running it. The gateway loads the plugin when it starts again.

With OpenClaw 2026.3.13, linking printed nothing else but its usual advice that
`plugins.allow` is empty (a list of the plugin ids to trust, which you may add `escape-fm`
to). OpenClaw 2026.3 scans a plugin it installs for code patterns such as starting a process,
which this one does (it starts the hook script); if it says so, that is what it is about.

The player opens in your browser the first time, already paired with the computer, if the
gateway runs on a computer with a screen. On a server, run this in your own terminal there
and open the link it prints on the device you listen on:

```bash
node ~/.escape-fm/openclaw/scripts/open.mjs --print
```

Requires Node 18 or later (OpenClaw itself needs 22). Uses `curl` when present, so proxy
settings from your environment are honoured.

## Uninstall

```bash
node integrations/openclaw/install.mjs --uninstall
```

runs `openclaw plugins uninstall escape-fm` and removes `~/.escape-fm/openclaw`.

## Pairing

On first use the integration creates a random listener key in
`~/.escape-fm/config.json`. The same key is used by escape.fm for every other agent on
this machine, so one player hears them all. The player receives it through the URL
fragment, which browsers never send to a server, and keeps it in local storage. Anyone
holding the key can see these tags, so treat the pairing link as private. Delete
`~/.escape-fm/config.json` to reset.

## Settings

Read from the gateway's environment:

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_COMPUTER_NAME` | The name sent as `computer` in place of this computer's own; set to nothing (`ESCAPE_FM_COMPUTER_NAME=`), no name is sent |
| `ESCAPE_FM_API`, `ESCAPE_FM_PLAYER` | Point at another relay or player, for development |
