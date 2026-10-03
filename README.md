# escape.fm plugins

[escape.fm](https://escape.fm) is background music that follows your work. These
plugins tell the player what your AI agent is doing, so the music can step back
while the agent runs and come forward when it needs you.

They are open source so that you can check, line by line, that they send two tags,
whether the agent's steps succeed, and nothing about your work.

The easiest way to install is to ask your agent to do it. Paste this into it:

> Install escape.fm for me: read https://escape.fm/install-plugin.md and follow it.

It works out which agent it is, shows you what it will change, and installs the right plugin.
[`install-plugin.md`](install-plugin.md) is that guide, written for the agent.

Or by hand:

| Agent | Folder | Install |
| --- | --- | --- |
| Claude Code | [`plugin/`](plugin/README.md) | `claude plugin marketplace add escape-fm/plugins` then `claude plugin install escape-fm@escape-fm` |
| Codex | [`integrations/codex/`](integrations/codex/README.md) | `codex plugin marketplace add escape-fm/plugins` then `codex plugin add escape-fm@escape-fm`, and trust the hooks in `/hooks` |
| Cursor | [`integrations/cursor/`](integrations/cursor/README.md) | Clone this repository and run `node integrations/cursor/install.mjs` (a listing in Cursor's marketplace is on its way) |
| Gemini CLI | [`integrations/gemini/`](integrations/gemini/README.md) | Clone this repository and run `gemini extensions install ./integrations/gemini` |
| GitHub Copilot CLI | [`integrations/copilot/`](integrations/copilot/README.md) | Clone this repository and run `node integrations/copilot/install.mjs` |
| Qwen Code | [`integrations/qwen/`](integrations/qwen/README.md) | Clone this repository and run `node integrations/qwen/install.mjs` |
| Factory Droid | [`integrations/droid/`](integrations/droid/README.md) | Clone this repository and run `node integrations/droid/install.mjs` |
| CodeBuddy Code | [`integrations/codebuddy/`](integrations/codebuddy/README.md) | Clone this repository and run `node integrations/codebuddy/install.mjs` |
| WorkBuddy | [`integrations/workbuddy/`](integrations/workbuddy/README.md) | Clone this repository and run `node integrations/workbuddy/install.mjs`, then quit WorkBuddy and open it again |
| Muse Code | [`integrations/muse/`](integrations/muse/README.md) | Clone this repository and run `node integrations/muse/install.mjs` |
| OpenClaw | [`integrations/openclaw/`](integrations/openclaw/README.md) | On the gateway's machine, clone this repository, run `node integrations/openclaw/install.mjs`, then `openclaw gateway restart` |

The first session after installing opens the player in your browser, already paired
with your machine. Press play there. They all share one pairing key, so one player
hears every agent on the machine.

So that new versions arrive on their own, turn on auto-update for the marketplace: in
Claude Code, `/plugin` → Marketplaces → escape-fm → Enable auto-update.

## What leaves your machine

On hook events, for each session:

| Field | Example | What it is |
| --- | --- | --- |
| `session` | `0VOjpHVpifDMyGA3` | A digest of the agent's session id, so several sessions can be told apart |
| `mode` | `debug` | One of eight work modes |
| `agent` | `running` | `user`, `running`, `waiting` or `idle` |
| `ts` | `1790765086341` | When the event happened |
| `computer` | `Ada's MacBook Pro` | This computer's name as you see it in your system settings (macOS: Computer Name; Windows and Linux: the host name), so your page can list it by name. Set `ESCAPE_FM_COMPUTER_NAME` to change it, or to an empty value to send none |
| `outcomes` | `[true, false]` | Whether each of the agent's steps since the last report (a command, an edit, an MCP tool) succeeded or failed, oldest first. Never what the step was. Left out when there are none, and never sent for Codex or Droid, which cannot tell |

When a session ends, one last report says so: `session`, `ts` and `end: true`, so its
state is removed at once rather than after half an hour.

Nothing else. Your prompt is read locally to choose the work mode
([`shared/classify.mjs`](shared/classify.mjs), a short keyword list) and is never
sent, stored or logged. Tool inputs, commands, file names, paths, outputs and error
messages are not read at all; whether a step failed is told by which event the agent
runs. The [privacy policy](https://escape.fm/privacy) covers what the service
keeps.

Each agent reports a little differently, and none of them can report everything;
[`docs/integrations.md`](docs/integrations.md) says exactly which states each one
can and cannot tell.

## Checking it yourself

```bash
node scripts/test-integrations.mjs
```

The test runs each plugin against a local stand-in for the server and asserts that
only those fields go out, outcomes as nothing but `true` or `false`, and that no
prompt, path, command, output, error or email address is ever sent or written to disk.

The logic they share lives once in `shared/`; each plugin folder carries a copy
because agents install a plugin by copying its folder. `node scripts/sync-integrations.mjs`
writes the copies, and the test fails if one has drifted.

## Settings

| Environment variable | Effect |
| --- | --- |
| `ESCAPE_FM_DISABLE=1` | Send nothing |
| `ESCAPE_FM_NO_OPEN=1` | Never open a browser |
| `ESCAPE_FM_HOME` | Keep the key and session state somewhere other than `~/.escape-fm` |
| `ESCAPE_FM_COMPUTER_NAME` | The name sent as `computer` in place of this computer's own; set to nothing (`ESCAPE_FM_COMPUTER_NAME=`), no name is sent |

## About this repository

It is published from escape.fm's own repository, where the player and the server
live; changes are made there and released here. Issues and questions are welcome
here or at [hello@escape.fm](mailto:hello@escape.fm).

MIT licensed. See [LICENSE](LICENSE).
