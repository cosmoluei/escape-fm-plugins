# Integrations

How escape.fm hears from coding agents other than Claude Code: what each agent lets a
script observe, what that leaves untold, and how the code is laid out. The reasoning
about the product is in the product doc; what each integration sends is in its README.

Researched on 2026-09-30 from the agents' own documentation, linked below, and then
checked as far as this machine allowed:

- **Codex was run.** The `codex` on the `PATH` (0.116.0 from npm) is an install with its
  binary missing, but the ChatGPT desktop app carries its own, `codex-cli
  0.158.0-alpha.2.1`. It was run with a home of its own (`CODEX_HOME`), signed in to
  nothing, against a stand-in model on localhost that plays a fixed script, with a
  local relay and a listener on it. What is marked **seen** below was seen in those runs.
- **Cursor was not.** It is not installed here, so everything about Cursor is what its
  documentation says. [What has not been seen working](#what-has-not-been-seen-working)
  lists what that leaves open.

## The contract

Every integration posts the same thing to the relay, `POST /v1/signal` with the
listener key as a bearer token, and nothing else:

| Field | What it is |
| --- | --- |
| `session` | A digest of the agent's session id |
| `mode` | One of eight work modes, chosen locally from the prompt |
| `agent` | `user`, `running`, `waiting` or `idle` |
| `ts` | When the event happened |

The key is in `~/.escape-fm/config.json` and is the same for every integration on the
machine, so one player hears all of them as separate sessions.

## Layout

```
shared/                 the code every integration runs, written once
  classify.mjs          prompt -> work mode
  lib.mjs               the key, the transport, opening the player
  session.mjs           a session's two tags between hook runs; what to report and when
  send.mjs              posts one report from a process of its own
  open.mjs              opens the player paired with this machine
  setup.mjs             adds hooks to an agent's hooks.json by hand
plugin/                 Claude Code (a Claude Code plugin, as before)
integrations/codex/     Codex (a Codex plugin, and install.mjs)
integrations/cursor/    Cursor (a Cursor plugin, and install.mjs)
scripts/sync-integrations.mjs   copies shared/ into the three
scripts/test-integrations.mjs   feeds each hook script its agent's events
```

Each integration's own `scripts/hook.mjs` is small: it says which of its agent's events
is which step (`start`, `prompt`, `tool`, `running`, `waiting`, `stop`, `end`) and how
that agent names its tools. It passes `session.mjs` the session id, the step and, for a
prompt, the text. Nothing else of an event goes any further than that one function.

**Why copies.** An agent installs an integration by copying its folder: Claude Code
and Codex into a plugin cache, Cursor from `~/.cursor/plugins/local`, `install.mjs`
into `~/.escape-fm`. A script there cannot import from this repository, so each folder
holds everything it runs. The copies are committed, because these folders are installed
straight from git with no build step. `pnpm integrations:sync` writes them, each with a
first line saying where it came from, and `pnpm integrations:check` fails if one has
drifted (it also runs the tests).

`plugin/` stays where it is, since `.claude-plugin/marketplace.json` points at it and
moving it would break installs that track this repository.

## What each agent can tell a script

| Moment | Claude Code | Codex | Cursor |
| --- | --- | --- | --- |
| A session starts | `SessionStart` | `SessionStart` | `sessionStart` |
| The listener sends a message | `UserPromptSubmit` (has the prompt) | `UserPromptSubmit` (has the prompt) | `beforeSubmitPrompt` (has the prompt) |
| A tool starts | `PreToolUse` | `PreToolUse`, except hosted tools such as web search | `preToolUse` |
| A tool finishes | `PostToolUse` | `PostToolUse` | `postToolUse`, `postToolUseFailure` |
| The agent waits for approval | `PermissionRequest`, `Notification` | `PermissionRequest` | **nothing** |
| The approval is answered | **nothing** | **nothing** | **nothing** |
| The agent asks a question | `PreToolUse` of `AskUserQuestion` or `ExitPlanMode`, `Notification` | `PreToolUse` of `request_user_input` or `request_permissions` (from source) | **nothing documented** |
| An MCP server asks for input | `Notification` | **nothing** | **nothing** |
| The turn ends | `Stop` | `Stop` | `stop`, status `completed` |
| The listener interrupts | **nothing** | `Interrupt` | `stop`, status `aborted` |
| The turn fails | `StopFailure` | **not documented** | `stop`, status `error` |
| The session ends | `SessionEnd` | `SessionEnd` | `sessionEnd` |

So `user`, `running` and `idle` can be told for all three. `waiting` can be told for
Claude Code and Codex, and for Cursor it cannot, except possibly for a question.

## Claude Code, seen again

The plugin was also run for real, in Claude Code 2.1.285 with `--plugin-dir`, a
configuration folder of its own, a made-up API key and a stand-in model on localhost,
so no account was used. Two things turned up that the plugin had wrong:

- **In `claude -p`, a background `Stop` hook kept `SessionEnd` from running.** The
  run ends as soon as the answer is written, the pending `Stop` hook is cancelled
  before it starts, and then no `SessionEnd` hook runs at all. Every headless run left
  its session on the relay as `running`, for the relay's 30 minutes. Seen three times
  in three with the plugin as it was on `main`; with a `Stop` hook in the foreground,
  `SessionEnd` ran every time.
- **`SessionEnd` hooks are stopped after about a second and a half**, whatever their
  `timeout` says (the plugin's said 5).

So `Stop`, `StopFailure` and `SessionEnd` now run in the foreground and hand their
report to a process of their own, which takes the hook about 70 ms. With that, the
same run is heard as `idle`, `user`, `running`, `idle`, and the session removed.

Also from the documentation, and not in the plugin's README: Claude Code runs no hook
when the listener interrupts a turn (`Stop` "does not run if the stoppage occurred due
to a user interrupt"), so an interrupted session keeps its last state until the next
message.

## Codex

Sources: [Hooks](https://learn.chatgpt.com/docs/hooks),
[Package your plugin](https://developers.openai.com/plugins/build/plugins),
[Plugins](https://learn.chatgpt.com/docs/plugins),
[Advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced),
[Environment variables](https://learn.chatgpt.com/docs/config-file/environment-variables),
and the [hook schemas](https://github.com/openai/codex/tree/main/codex-rs/hooks/schema/generated)
and tool dispatch in the `main` branch of `openai/codex`.

### Mechanisms

- **Hooks.** Commands run on lifecycle events, with one JSON object on stdin. On by
  default; `[features] hooks = false` turns them off. Events: `SessionStart`,
  `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse`,
  `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, `Stop`, `Interrupt`.
- **`notify`.** A program run with one JSON argument, for `agent-turn-complete` only
  (`thread-id`, `turn-id`, `cwd`, `input-messages`, `last-assistant-message`). It can
  say a turn ended and nothing else, it cannot be set from a project's config, and it
  puts the prompt on a command line. Hooks cover it; it is not used.

### What a hook is given

Every event: `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`. Most
also `permission_mode` (`default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`)
and `turn_id`.

| Event | Also carries | Notes |
| --- | --- | --- |
| `SessionStart` | `source`: `startup`, `resume`, `clear`, `compact` | `compact` runs after a compaction, which can be in the middle of a turn |
| `UserPromptSubmit` | `prompt` | No matcher |
| `PreToolUse` | `tool_name`, `tool_use_id`, `tool_input` | Shell is `Bash`, edits are `apply_patch`, MCP tools `mcp__server__tool`, other local tools by their own name. Not hosted tools |
| `PermissionRequest` | `tool_name`, `tool_input` | Only when Codex is about to ask. Not for commands that need no approval |
| `PostToolUse` | the same, and `tool_response` | Also after a command that exits non-zero |
| `Stop` | `stop_hook_active`, `last_assistant_message` | The main thread only |
| `Interrupt` | | When the listener interrupts an active turn on the main thread |
| `SessionEnd` | `reason`, always `other` | When Codex closes normally, when an open conversation is archived or deleted, or after 30 minutes idle and open in no client |
| `SubagentStart`, `SubagentStop` | `agent_id`, `agent_type` | Use the parent's `session_id` |

**Seen** in the runs, and matching the documentation: every payload above, field for
field, including `tool_name` `Bash` for a shell command and `apply_patch` for an edit.
Also seen, and not in the documentation:

- The order is `PreToolUse`, `PermissionRequest`, the tool, `PostToolUse`.
- The tool that asks the listener a question reaches `PreToolUse` as
  `request_user_input`. When Codex refuses the call (the tool is only offered in plan
  mode), no `PostToolUse` follows.
- A subagent's events arrive under its parent's `session_id`, marked with `agent_id`
  and `agent_type`. That includes a `UserPromptSubmit` carrying what the parent told
  it, which is not the listener's message. `Stop` runs once, for the parent.
- `session_id` is the same after `codex exec resume`, with `source: "resume"`.
- **A turn that fails runs no `Stop`.** The model's request was refused; Codex
  reported the error and the next event was `SessionEnd`.

### Rules that shape the integration

- A hook that is not managed by an administrator **does not run until the listener
  has reviewed and trusted it** with `/hooks`. Trust is recorded against the hook's
  hash, so a changed definition has to be trusted again. This holds for a plugin's
  hooks too: installing the plugin is not enough. **Seen**: installed hooks are listed
  as `untrusted` and nothing runs; once each hook's hash is under `[hooks.state]` in
  `config.toml`, which is what `/hooks` writes, they run.
- `async: true` runs a command hook in the background; up to eight at once per
  session, and unfinished ones are cancelled when the session ends. **Seen**: in
  `codex exec`, where the session ends the moment the turn does, a background `Stop`
  hook's report never got out. So `Stop` runs in the foreground, like `Interrupt` and
  `SessionEnd`, and all three hand their report to a process of its own and return at
  once. The other events stay in the background.
- `SessionEnd` and `Interrupt` get one second by default and three at most, and
  `SessionEnd` is never run in the background.
- `Stop` and `Interrupt` accept no plain text on stdout. No output at all is success.
- Project hooks (`<repo>/.codex/hooks.json`) load only in a trusted project.

### Where configuration lives, and how an integration is distributed

| | |
| --- | --- |
| User | `~/.codex/hooks.json`, or `[hooks]` tables in `~/.codex/config.toml`. `CODEX_HOME` moves `~/.codex` |
| Project | `<repo>/.codex/hooks.json` or `<repo>/.codex/config.toml`, in trusted projects |
| Managed | `requirements.toml`, by an administrator |
| Plugin | `hooks/hooks.json` in the plugin, or the path named in its manifest. Commands are given `PLUGIN_ROOT` (and `CLAUDE_PLUGIN_ROOT`) |

Plugins are found through marketplaces: a repository's
`.agents/plugins/marketplace.json`, a personal `~/.agents/plugins/marketplace.json`,
and, for compatibility, a repository's `.claude-plugin/marketplace.json`.
`codex plugin marketplace add` adds one, and `codex plugin add name@marketplace` or
`/plugins` installs from it, into `~/.codex/plugins/cache`. The public directory shared
by ChatGPT and Codex takes submissions; nothing has been submitted.

Two things here are **not as documented**, and both were seen:

- **The manifest has to be `.codex-plugin/plugin.json`.** The documentation's
  preferred form, `plugin.json` at the plugin's root with Codex's settings under
  `extensions.com.openai`, installs and enables, and its hooks are never loaded:
  Codex's loader skips hooks for a plugin in that format. With both files present the
  root one wins, and the hooks are lost the same way. So the integration has only the
  older manifest.
- **This repository needs `.agents/plugins/marketplace.json`.** Without it Codex
  falls back to `.claude-plugin/marketplace.json` and offers the Claude Code plugin.
  That plugin's `hooks.json` gives each hook as `command: "node"` with the script in
  `args`; Codex keeps the command and drops the arguments, so every hook would be a
  bare `node` fed the event. With the Codex marketplace file present, Codex uses it and
  does not show the other.

### What Codex cannot tell

- **After an approval is answered**, nothing runs until the tool finishes, as with
  Claude Code: a long approved command shows as `waiting` until it ends. **Seen**: a
  three-second command approved after three seconds showed `waiting` for six.
- **A turn that fails** runs no hook (seen, above). The session keeps the state it
  had, `running` or `user`, until the next message or the session's end.
- **An MCP server asking for input** has no event.
- **Hosted tools** (web search) run no tool hooks, so a turn that only searches shows
  as `user` until it stops.
- **Reading** cannot be told from the tool name: Codex reads files with shell
  commands, and a command is not looked into.
- **Cloud tasks** do not run hooks from local configuration.

## Cursor

Sources: [Hooks](https://cursor.com/docs/hooks),
[Third-party hooks](https://cursor.com/docs/reference/third-party-hooks),
[Plugins](https://cursor.com/docs/plugins),
[Plugins reference](https://cursor.com/docs/reference/plugins),
[CLI changelog](https://cursor.com/docs/cli/changelog).

### Mechanisms

- **Hooks.** Commands run at stages of the agent loop, with JSON on stdin. Agent
  events: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`,
  `postToolUse`, `postToolUseFailure`, `subagentStart`, `subagentStop`,
  `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`,
  `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `preCompact`, `stop`,
  `afterAgentResponse`, `afterAgentThought`. There are also Tab events (inline
  completions, not the agent) and `workspaceOpen`.
- There is no separate notification mechanism.

### What a hook is given

Every agent event: `conversation_id` (stable across turns), `generation_id` (changes
with every message), `model`, `hook_event_name`, `cursor_version`, `workspace_roots`,
`user_email`, `transcript_path`.

| Event | Also carries | Notes |
| --- | --- | --- |
| `sessionStart` | `session_id` (the same as `conversation_id`), `is_background_agent`, `composer_mode` | When a new conversation is created. Fire-and-forget |
| `beforeSubmitPrompt` | `prompt`, `attachments` | After send, before the request |
| `preToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `cwd` | All tools. Names include `Shell`, `Read`, `Write`, `Grep`, `Delete`, `Task`, `MCP:<name>` |
| `postToolUse` | the same, and `tool_output`, `duration` | After a tool succeeds |
| `postToolUseFailure` | `error_message`, `failure_type` (`error`, `timeout`, `permission_denied`), `is_interrupt` | After a tool fails, times out or is denied |
| `stop` | `status`: `completed`, `aborted`, `error` | When the agent loop ends |
| `sessionEnd` | `session_id`, `reason`: `completed`, `aborted`, `error`, `window_close`, `user_close` | When a conversation ends |

### Rules that shape the integration

- **Cursor waits for a hook, and reads what it prints as an answer.** There is no
  background option. For the hooks that can allow or deny (`preToolUse` among them),
  output that is not the expected JSON blocks the action, and exit code 2 denies it.
  Other failures let the action through. The documentation's own audit example prints
  nothing from such hooks, which is what the integration does.
- Project hooks run from the project root, user hooks from `~/.cursor/`.
- Cursor watches `hooks.json` and reloads it; no restart.
- Cursor also loads Claude Code hooks from `.claude/settings.json` files (on by
  default) and maps their events, but not `Notification` or `PermissionRequest`: it
  has nothing to map them to.

### Where configuration lives, and how an integration is distributed

| | |
| --- | --- |
| User | `~/.cursor/hooks.json` |
| Project | `<project>/.cursor/hooks.json`, in a trusted workspace. Cloud agents load these, and not the user's |
| Enterprise, team | A system path, or the dashboard |
| Plugin | `hooks/hooks.json` in a plugin with `.cursor-plugin/plugin.json` |

Plugins are installed from the Cursor Marketplace, where every plugin is reviewed by
hand after a submission at cursor.com/marketplace/publish (nothing has been
submitted), from a team marketplace, or, for trying one, from
`~/.cursor/plugins/local/<name>` (a real folder; a symlink out of it is skipped). A
repository with several plugins lists them in `.cursor-plugin/marketplace.json`.

**The CLI** (`agent`, formerly `cursor-agent`) shares the mechanism: it reads the same
`hooks.json` files and, since the August 2026 release, runs hooks from installed
plugins and from `--plugin-dir`. Its changelog names session start and end, stop,
subagent, compaction, `beforeSubmitPrompt`, `afterAgentThought` and
`afterAgentResponse`; it does not say in so many words that `preToolUse` and
`postToolUse` run there.

### What Cursor cannot tell

- **Waiting for approval has no event at all.** A command that Cursor asks the
  listener to allow shows as `running` for as long as the prompt is up. The third-party
  hooks page says as much: it lists Claude Code's `PermissionRequest` and
  `Notification` as having no Cursor counterpart.
- **A question to the listener** is not among the documented tool names. The script
  treats a tool named `AskQuestion` as one; whether Cursor reports it is not known.
- **Thinking and answering** do have events (`afterAgentThought`,
  `afterAgentResponse`), which are not subscribed to: they carry the agent's text, and
  the state is the same without them.
- **Cloud agents** load project hooks only, and run neither `sessionStart` nor
  `sessionEnd`. With the hooks in `~/.cursor/hooks.json` they are not heard at all.

## What has not been seen working

All three hook scripts are checked by `pnpm integrations:check`, which feeds them
events in the documented shape against a stand-in relay.

Codex, seen with 0.158.0-alpha.2.1 and a local relay with a listener on it:
- Both ways of installing: `install.mjs`, and the plugin through
  `codex plugin marketplace add` and `codex plugin add`, with
  `node "${PLUGIN_ROOT}/scripts/hook.mjs"` resolving into the plugin cache.
- `codex exec` turns with a shell command, two edits, a question, a subagent, a
  resumed session and a failed request.
- A session that stays open, driven over the app-server protocol as an editor drives
  it: the listener heard `idle`, `user`, `running`, `waiting` at the approval prompt,
  `running` when the approved command finished, `idle` at the end of the turn, `user`,
  `idle` at the interrupt, and the session removed when Codex closed.

Codex, still open:
- The terminal interface itself, and with it how Codex shows the one line the first
  session start prints (`systemMessage`). `codex exec` does not show it.
- Which version first has `Interrupt`, `SessionEnd` and `async`, and what an older one
  does with a `hooks.json` that names them.
- The IDE extension and the desktop app. They run the same app-server, but were not
  opened.

Cursor, all of it still open:
- That an empty answer from `preToolUse` and `beforeSubmitPrompt` is taken as no
  opinion, as the documentation's example implies.
- When `sessionStart` runs relative to the first `beforeSubmitPrompt`. The script
  assumes they can run together, and so reports nothing at a session's start.
- Whether a subagent's tools arrive under the parent's `conversation_id` or one of
  their own. The script is safe either way: only a message opens a session.
- The value of `hook_event_name`. The script does not depend on it; `hooks.json`
  passes the event's name on the command line.
- That a plugin's hook commands run from the plugin's root, as the reference's
  `./scripts/...` example implies.
- That `node` is on the `PATH` Cursor gives a hook when started from the Dock.
- Which events the CLI runs.
- What Cursor's import of third-party configuration (on by default, and named as
  covering plugins) does with the Claude Code plugin when both are on one machine. The
  documentation only describes hooks in `.claude/settings.json` files.

Windows has not been tried for either.
