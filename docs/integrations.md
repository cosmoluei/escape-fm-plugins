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

Four more agents were added on 2026-10-02, after looking at every coding agent that might
let a script listen to it ("Agents with no integration", below, has the ones left out):
**Gemini CLI**, **GitHub Copilot CLI**, **Qwen Code** and **Factory Droid**. Each runs a
command of its own on documented events, without the model choosing to. None of them is
installed here, and nothing was signed in to, so all four are written from their
documentation (and, for Gemini CLI and Qwen Code, their source on GitHub), read on
2026-10-02, and checked only with events in the documented shape.

## The contract

Every integration posts the same thing to the relay, `POST /v1/signal` with the
listener key as a bearer token, and nothing else:

| Field | What it is |
| --- | --- |
| `session` | A digest of the agent's session id |
| `mode` | One of eight work modes, chosen locally from the prompt |
| `agent` | `user`, `running`, `waiting` or `idle` |
| `ts` | When the event happened |
| `computer` | This computer's name as its owner sees it in the system settings, so the account's page can list the machine by name (below). Left out when there is none |
| `outcomes` | Whether each of the agent's steps since the last report went through: `true` or `false`, oldest first, at most 32 ("Outcomes", below). Left out when there are none |

When a session ends the last report is `session`, `ts` and `end: true` instead, and the
relay removes the session at once. With none left open, the relay keeps when the last one
ended and tells the account's players (docs/design.md, "The end of the day"). An
integration that never reports an end (an older version, a machine that went to sleep,
Cursor's cloud agents) still works: its session ages out after 30 minutes, and the relay
counts the work as stopped when it was last heard from.

Every report carries a `User-Agent` header, `escape-fm/<version> (<client>)` with the
client `claude-code`, `codex`, `cursor`, `gemini-cli`, `copilot-cli`, `qwen-code` or `droid`, so the relay can tell the integrations and
their versions apart (docs/analytics.md). It is set once, in `shared/lib.mjs`, on both
transports (curl and the `fetch` fallback), from a `client.mjs` that
`scripts/sync-integrations.mjs` writes into each integration from its manifest's
`version`. Nothing else about the machine goes in it.

The key is in `~/.escape-fm/config.json` and is the same for every integration on the
machine, so one player hears all of them as separate sessions.

### Outcomes

Decided on 2026-10-02: an integration may tell the relay whether an agent's step succeeded or
failed, so the music can follow an agent that keeps failing (docs/design.md, "When the work goes
round in circles"). Only the yes or no: never the error, the command, the file, the tool's name or
its output, nor a digest of any of them.

- A **step** is a tool the agent ran that does something: a shell command, an edit, an MCP tool.
  Reading and searching, and asking the listener, are not steps: a search that finds nothing is not
  the agent failing. Each hook script says which of its agent's tools are which, by name.
- Where it can, an integration takes the outcome from **which event** its agent runs (a failure event
  beside the ordinary one), so nothing of what the tool returned is looked at. Where an agent has no
  such event, it looks only at the one field that says whether the step went through (an exit code, a
  success flag), and at nothing else of the result. Each agent's section says which.
- A tool the listener stopped, or would not allow, did not fail, and is no outcome.
- Outcomes are kept with the session's state between hook runs and go with the next report, which
  they do not hasten: while an agent works that is at least every 45 seconds, and at the end of its
  turn. A session that ends drops the ones not yet sent.
- The relay keeps a task's outcomes of the last 12 minutes (at most 48), stamped with when the report
  came, for as long as the task, and tells players only `steadyUntil`, until when to hold the music
  steadier (`api/src/outcomes.ts`). The account's export lists them.

### The computer's name

`computer` is the one thing about the machine a report carries, and only the name its
owner gave it, worked out by `shared/computer.mjs`:

- macOS: the Computer Name (`scutil --get ComputerName`, System Settings → General →
  Sharing), as typed, `Ada’s MacBook Pro`. If that fails, the host name as below.
- Linux: `PRETTY_HOSTNAME` from `/etc/machine-info` when it is set, otherwise the host name.
- Windows: the host name.

A host name is made readable: the domain after the first dot goes (`.local`, `.lan`),
`-`, `_` and spaces split words, a word all in lower case or (three letters or more) all
in upper case is capitalised, and anything else is kept as it is: `ada-thinkpad` is
`Ada Thinkpad`, `DESKTOP-AB12CD` is `Desktop AB12CD`, `ADA-PC` is `Ada PC`. A host name
that says nothing sends no name: `localhost`, an address (`10.0.0.5`, `ip-172-31-5-10`),
or a long hex or UUID-like id, as containers and cloud machines have. The name is trimmed,
loses control and invisible characters, and is cut at 40 characters (code points).

`ESCAPE_FM_COMPUTER_NAME` replaces it; set to nothing, no name is sent at all. Hooks run
often, so the name is looked up once a day and kept in `~/.escape-fm/computer.json`
(`{ name, at }`), a file of its own: `config.json` is rewritten by whichever hook gets
there first. The last report of a session, the `end`, carries no name.

The relay cleans the name again (`cleanName` in `api/src/names.ts`) and reads it apart
from the four tags, which keep dropping everything else. It becomes the device's label
once the key is claimed, and a new one renames it (docs/accounts.md, "`label`").

## Installing and updating

How each is installed is in `release/plugins/README.md` (published as the public
repository's README) and each integration's own README. Existing installs only update when
the `version` in a plugin's manifest goes up, and Claude Code only fetches a new version by
itself when auto-update is on for the marketplace, so the install instructions ask for it:
`/plugin` → Marketplaces → escape-fm → Enable auto-update. A machine still on an older
version keeps working; the relay accepts every report any released version has sent.

## Layout

```
shared/                 the code every integration runs, written once
  classify.mjs          prompt -> work mode
  lib.mjs               the key, the transport, opening the player
  computer.mjs          this computer's name, kept a day in ~/.escape-fm/computer.json
  session.mjs           a session's two tags between hook runs; what to report and when
  send.mjs              posts one report from a process of its own
  open.mjs              opens the player paired with this machine
  setup.mjs             adds hooks to an agent's hooks.json or settings.json by hand
                        (each integration also gets a client.mjs: its name and version, from its manifest)
plugin/                 Claude Code (a Claude Code plugin, as before)
integrations/codex/     Codex (a Codex plugin, and install.mjs)
integrations/cursor/    Cursor (a Cursor plugin, and install.mjs)
integrations/gemini/    Gemini CLI (a Gemini CLI extension, and install.mjs)
integrations/copilot/   GitHub Copilot CLI (install.mjs, and a Copilot CLI plugin)
integrations/qwen/      Qwen Code (install.mjs)
integrations/droid/     Factory Droid (install.mjs, and a Droid plugin)
scripts/sync-integrations.mjs   copies shared/ into each, and writes each one's client.mjs
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
| A tool fails | `PostToolUseFailure`, a command that exits non-zero included | **nothing**: a failed command runs `PostToolUse` with no exit code, a failed patch runs no hook (from source) | `postToolUseFailure`, `failure_type` `error` or `timeout` |
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
Outcomes can be told for Claude Code and Cursor, and for Codex they cannot.

And for the four added on 2026-10-02:

| Moment | Gemini CLI | Copilot CLI | Qwen Code | Droid |
| --- | --- | --- | --- | --- |
| A session starts | `SessionStart` | `sessionStart` | `SessionStart` | `SessionStart` |
| The listener sends a message | `BeforeAgent` (has the prompt) | `userPromptSubmitted` (has the prompt) | `UserPromptSubmit` with `submitted_prompt` | `UserPromptSubmit` (has the prompt) |
| A tool starts | `BeforeTool`, before the approval | `preToolUse` (**not used**, below) | `PreToolUse`, after the approval | `PreToolUse` |
| A tool finishes | `AfterTool` | `postToolUse` | `PostToolUse` | `PostToolUse` |
| A tool fails | `AfterTool` with `tool_response.error`; **not** a shell command that exits non-zero | `postToolUseFailure` | `PostToolUseFailure`, a shell command that exits non-zero included | **nothing documented** |
| The agent waits for approval | `Notification`, `ToolPermission` | `notification`, `permission_prompt` | `PermissionRequest`, `Notification` | `Notification`, `permission_prompt` |
| The agent asks a question | `BeforeTool` of `ask_user` | `notification`, `elicitation_dialog` | `PreToolUse` of `ask_user_question` | `PreToolUse` of `AskUser`, `Notification` |
| The turn ends | `AfterAgent` | `agentStop` | `Stop` | `Stop` |
| The listener interrupts | **nothing** | **nothing documented** | **nothing** | `Notification`, `idle_prompt` |
| The turn fails | **nothing** | `errorOccurred` (not used) | `StopFailure` | **nothing documented** |
| The session ends | `SessionEnd`, not waited for | `sessionEnd` | `SessionEnd` | `SessionEnd` |

## Claude Code's outcomes

From [Hooks](https://code.claude.com/docs/en/hooks), read on 2026-10-02: `PostToolUse` runs
"after a tool call succeeds", and `PostToolUseFailure` "when a tool that started executing
fails": the tool threw an error, an MCP tool returned an error result, or a Bash command ran
and exited non-zero (its `error` begins `Exit code N`). It does not run for a call refused
before it started (a denied permission runs `PermissionDenied`), nor for a running tool the
listener cancels; `is_interrupt` marks a failure that was an abort. So the plugin takes the
outcome from which of the two runs and reads nothing of `tool_response` or `error`; an
interrupt is no outcome. `PostToolUseFailure` is a new hook in the plugin's `hooks.json`, in the
background like `PostToolUse`.

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

- **Whether a step failed.** A shell command that exits non-zero runs the same
  `PostToolUse` as one that succeeds, and its `tool_response` is the command's output as
  a plain string, with no exit code (the "exited with code" line goes to the model only);
  a patch that does not apply runs no `PostToolUse` at all, and there is no failure event
  (`core/src/tools/registry.rs` and `context.rs` on `main`, read on 2026-10-02). So Codex
  sends no outcomes. Telling a failed patch by the `PostToolUse` that never comes was
  considered and left out: the hooks run as parallel background processes, so a late
  `PostToolUse` would read as a failure.
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

- **Whether a shell command that exits non-zero is a failure** (`postToolUseFailure`) or
  a `postToolUse` whose output says so is not documented. A failure of type
  `permission_denied` is the listener's no, not the agent failing, and is no outcome.
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

## Gemini CLI

Sources, read on 2026-10-02 (Gemini CLI 0.62.0, 2026-09-29):
[Hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/index.md),
[Hooks reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/reference.md),
[Writing hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/writing-hooks.md),
[Extension reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md),
and `packages/cli/src/config/extension-manager.ts` and the shell tool on `main`.

### Mechanisms

- **Hooks**, on by default since 0.26 (`hooksConfig.enabled`). Events: `SessionStart`,
  `SessionEnd`, `BeforeAgent`, `AfterAgent`, `BeforeModel`, `AfterModel`,
  `BeforeToolSelection`, `BeforeTool`, `AfterTool`, `PreCompress`, `Notification`. The
  model events carry the conversation and are not subscribed to.
- Every hook gets `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`.
  `BeforeAgent` adds `prompt`; `BeforeTool` `tool_name`, `tool_input`; `AfterTool` also
  `tool_response` (`llmContent`, `returnDisplay`, and `error` when the tool failed);
  `AfterAgent` `prompt`, `prompt_response`; `Notification` `notification_type`
  (`ToolPermission`), `message`, `details`; `SessionStart` `source`; `SessionEnd` `reason`.
- Tools: `run_shell_command`, `replace` and `write_file` (edits), `read_file`,
  `read_many_files`, `glob`, `grep_search`, `list_directory`, `web_fetch`,
  `google_web_search`, `ask_user`, MCP tools as `mcp_<server>_<tool>`.

### Rules that shape the integration

- Gemini CLI **waits for every hook** (except `SessionEnd`, which it does not wait for)
  and parses what it prints as JSON; text on stderr at exit 0 is shown to the listener.
  So the script prints nothing but the one welcome (`systemMessage`, shown at a session's
  start) and hands every report but a session's start to a process of its own.
- `timeout` is in milliseconds.
- **Outcomes**: a tool's result carries `error` when it failed (`edit_no_occurrence_found`,
  `shell_execute_error`: the command could not run, …), and only whether it is there is
  looked at. A shell command that ran and exited non-zero has no `error`: its exit code is
  only a line in `llmContent`, the text the model is given, which is not read. So an edit
  or an MCP tool is `true` or `false`, and a shell command is `false` when it could not
  run and otherwise nothing.

### Where configuration lives, and how it is distributed

| | |
| --- | --- |
| User | `~/.gemini/settings.json`, under `hooks` |
| Project | `<project>/.gemini/settings.json`. A changed project hook is warned about before it runs |
| System | `/etc/gemini-cli/settings.json` |
| Extension | `hooks/hooks.json` in the extension, `{ "hooks": { … } }`, with `${extensionPath}` replaced by the extension's folder (from source) |

The integration is an extension (`gemini-extension.json`): `gemini extensions install
<path or GitHub URL>` copies it and asks the listener to confirm its hooks. A GitHub URL
must point at a repository with the extension at its root, which the public repository is
not, so it is installed from a checkout. `install.mjs` writes the same hooks into
`~/.gemini/settings.json` instead; in a folder Gemini CLI does not trust, it skips hooks
from settings (from source), and an extension's it runs anyway.

### What Gemini CLI cannot tell

- **A shell command that failed** (above): a run of failing tests is not seen as one.
- **An interrupted or failed turn** runs no hook: `AfterAgent` runs only when a turn
  completes. The session keeps its state until the next message.
- **Whether a tool is running or waiting for approval**: `BeforeTool` runs before the
  approval, `Notification` when the prompt shows, and nothing when it is answered.

## GitHub Copilot CLI

Sources, read on 2026-10-02 (Copilot CLI 1.0.91, 2026-10-01):
[Hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference),
[Using hooks with Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks),
[CLI plugin reference](https://docs.github.com/en/copilot/reference/cli-plugin-reference),
[changelog](https://github.com/github/copilot-cli/blob/main/changelog.md).

### Mechanisms

- **Hooks**: `sessionStart`, `sessionEnd`, `userPromptSubmitted`, `userPromptTransformed`,
  `preToolUse`, `postToolUse`, `postToolUseFailure` (since 1.0.15; `postToolUse` runs only
  after a tool succeeds since then), `permissionRequest`, `notification` (since 1.0.18),
  `agentStop`, `subagentStart`, `subagentStop`, `errorOccurred`, `preCompact`.
- **The event's name chooses the payload's shape.** Named in camelCase (`postToolUse`), a
  hook gets camelCase fields: `sessionId`, `timestamp` (ms), `cwd`, `toolName`, `toolArgs`
  (a JSON string in the documentation's example), `toolResult`, `error`, `prompt`,
  `stopReason`, `reason`. Named in PascalCase (`PostToolUse`), it gets the snake_case fields
  of VS Code's hooks and Claude Code's tool names. The integration uses camelCase, and reads
  `session_id` and `tool_name` too.
- Tools: `bash`, `powershell`, `edit`, `create`, `str_replace_editor`, `apply_patch`,
  `view`, `glob`, `grep`, `rg`, `web_fetch`, `web_search`, `ask_user`, `task`.
- `notification` is fire-and-forget, with `notification_type` `permission_prompt`,
  `elicitation_dialog`, `shell_completed`, `agent_completed`, `agent_idle`, …

### Rules that shape the integration

- Hooks run synchronously (30 s by default, `timeoutSec`); empty output is no answer. So
  the script prints nothing and hands every report to a process of its own.
- **`preToolUse` fails closed**: a hook that crashes or exits non-zero (other than timing
  out) denies the tool. A machine whose `PATH` has no `node` would have every tool denied,
  so the integration does not listen to `preToolUse` (or `permissionRequest`, which can
  decide too). A tool is heard of when it finishes, and its name counts then.
- What a `sessionStart` hook prints can only add context for the model, so the first
  session only opens the player and says nothing.

### Where configuration lives, and how it is distributed

| | |
| --- | --- |
| User | every `*.json` in `~/.copilot/hooks/` (`$COPILOT_HOME/hooks`), `{ "version": 1, "hooks": { … } }`, or `hooks` in `~/.copilot/settings.json` |
| Repository | `.github/hooks/*.json`, after the folder is trusted (1.0.8); the cloud agent reads only these |
| Policy | `/etc/github-copilot/policy.d/*.json` |
| Plugin | `hooks.json` or `hooks/hooks.json` in a plugin, `copilot plugin install OWNER/REPO:PATH` |

`install.mjs` writes a file of its own, `escape-fm.json`, into the user folder, so
uninstalling only removes that file. The folder is also a plugin (`plugin.json`); whether
`${PLUGIN_ROOT}` is replaced in a plugin's hook commands is not documented (it is for MCP
servers), so the plugin is offered as untried.

### What Copilot CLI cannot tell

- **A tool's start**, as used here (above): a turn shows as the listener typing until its
  first tool finishes.
- **Whether a shell command that exits non-zero is a failure** is not documented.
- **An interrupted turn**: `agentStop` has only `stopReason: "end_turn"`. A failed turn
  is `errorOccurred`, which is not used: whether the turn goes on after one is not said.
- `copilot -p` runs `sessionEnd` after every prompt (1.0.78), so each prompt is a session.
- **VS Code reads the same `~/.copilot/hooks`** but runs its own PascalCase events with its
  own payloads; whether it runs camelCase entries is not documented.

## Qwen Code

Sources, read on 2026-10-02 (Qwen Code 0.24.7 on `main`):
[Hooks](https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/hooks.md), and
the shell tool's exit handling in the source.

### Mechanisms

- **Hooks**, on by default (`disableAllHooks` turns them off), in Claude Code's shape:
  `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `PostToolBatch`, `PermissionRequest`, `PermissionDenied`,
  `Notification`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`, `PreCompact`,
  `PostCompact`, and more. Every hook gets `session_id`, `transcript_path`, `cwd`,
  `hook_event_name`, `timestamp`, `permission_mode` (`default`, `plan`, `auto_edit`,
  `auto`, `yolo`), and `agent_id` inside a subagent.
- `PostToolUse` runs after a tool succeeds and `PostToolUseFailure` after it fails, with
  `error` and `is_interrupt`; a shell command that exits non-zero is a failure, except an
  exit of 1 from a search command such as `grep` (from source).
- **`UserPromptSubmit` runs before every call to the model**, with tool results too; its
  `prompt` is not necessarily the listener's. `submitted_prompt` is set only for what the
  listener submitted, and only that is read.
- `Stop` is skipped when the listener interrupts; `StopFailure` runs instead of it when an
  API error or a loop ends the turn (not for API errors under `-p`).
- Tools: `run_shell_command`, `edit`, `write_file`, `read_file`, `read_many_files`,
  `grep_search`, `glob`, `list_directory`, `web_fetch`, `web_search`,
  `ask_user_question`, `todo_write`, `agent`.

### Rules that shape the integration

- `async: true` runs a hook in the background, ten at most at once (more are skipped);
  background hooks still running when Qwen Code exits are ended. So `Stop`, `StopFailure`
  and `SessionEnd` run in the foreground and hand their report to a process of their own;
  the rest are in the background.
- Plain text on stdout from `SessionStart` or `UserPromptSubmit` goes to the model; a JSON
  object is read as an answer. The script prints only the first session's welcome, as
  `systemMessage`.
- `timeout` is in seconds (1000 or more is read as milliseconds). A hook with a `name`
  can be switched off by itself; the integration's are all named `escape-fm`.

### Where configuration lives

| | |
| --- | --- |
| User | `~/.qwen/settings.json`, under `hooks` |
| Project | `<project>/.qwen/settings.json`, in a trusted folder |
| Extension | the manifest's `hooks`, or `hooks/hooks.json` |

`install.mjs` adds the hooks to `~/.qwen/settings.json`. The folder carries a
`qwen-extension.json` too; how Qwen Code replaces a path in an extension's hook commands
was not confirmed, so the extension is offered as untried.

### What Qwen Code cannot tell

- **An interrupted turn** runs no hook; a tool that was running ends in
  `PostToolUseFailure` with `is_interrupt`, which is no outcome.
- A `-p` run may end without `SessionEnd` (not documented either way).

## Factory Droid

Sources, read on 2026-10-02:
[Hooks](https://docs.factory.com/harness/hooks.md),
[Hooks reference](https://github.com/Factory-AI/factory/blob/main/docs/reference/hooks-reference.mdx),
[Plugins](https://docs.factory.com/harness/plugins.md).

### Mechanisms

- **Hooks**, always on: `SessionStart`, `SessionEnd`, `UserPromptSubmit`, `PreToolUse`,
  `PostToolUse`, `Notification`, `Stop`, `SubagentStop`, `PreCompact`. Every hook gets
  `session_id`, `transcript_path`, `cwd`, `permission_mode` (`off`, `spec`, `auto-low`,
  `auto-medium`, `auto-high`) and `hook_event_name`.
- `Notification` has `notification_type` `permission_prompt`, `idle_prompt`,
  `elicitation_dialog`, `auth_success`. **A cancelled turn runs `Notification`
  (`idle_prompt`) instead of `Stop`**, so `idle_prompt` is the end of a turn too.
- Spec mode (`permission_mode: spec`) is Droid's planning, and counts as plan mode.
- Tools: `Execute`, `Edit`, `Create`, `ApplyPatch`, `Read`, `LS`, `Glob`, `Grep`,
  `FetchUrl`, `WebSearch`, `Task`, `TodoWrite`, `AskUser`, `mcp__<server>__<tool>`.

### Rules that shape the integration

- Droid waits for every hook (60 s by default) and has no background option. Stdout at
  exit 0 goes to the model from `SessionStart` and `UserPromptSubmit`, and into the
  transcript from the others. So the script prints nothing at all, and hands every report
  to a process of its own.
- `~/.factory/hooks.json` is the event map itself, not under `hooks`; with no
  `hooks.json`, Droid reads `hooks` in `settings.json`. `install.mjs` adds to whichever the
  listener uses, so a new `hooks.json` never hides hooks kept in `settings.json`.
- Plugins: `.factory-plugin/plugin.json` and `hooks/hooks.json` with `${DROID_PLUGIN_ROOT}`.
  Droid reads `.factory-plugin/marketplace.json` first and falls back to
  `.claude-plugin/marketplace.json`, which offers the Claude Code plugin, whose
  `command: "node"` with `args` Droid's hooks do not have. So the repository has a
  `.factory-plugin/marketplace.json` of its own pointing at `integrations/droid`.

### What Droid cannot tell

- **Whether a step failed**: `PostToolUse` is documented as running after a tool succeeds
  (the newer page says "completes"), there is no failure event, and `tool_response`'s
  shape is not documented beyond a file tool's `success: true`. So Droid sends no outcomes.
- **A failed turn** has no event.

## Agents with no integration

Looked at on 2026-10-02, and left out:

- **Windsurf.** Cascade had hooks (`pre_run_command`, `post_cascade_response`, …; no
  failure, approval or session events), but Windsurf became Devin Desktop and Cascade was
  removed in 3.9.19 (2026-09-08; [hooks](https://docs.devin.ai/desktop/cascade/hooks)).
  Its successor, Devin Local, reads Claude Code's `~/.claude/settings*.json` hooks by
  default ([lifecycle hooks](https://docs.devin.ai/cli/extensibility/hooks/lifecycle-hooks.md));
  the Claude Code plugin's hooks live in the plugin, not there, so it does not run them.
- **Cline.** Hooks are executables named after events in `~/Documents/Cline/Hooks/`, and
  the documentation has been replaced by an SDK plugin page
  ([hooks](https://docs.cline.bot/customization/hooks.md)); `success` reflects the tool's
  handler, not a command's exit code, and there is no reliable session end.
- **Kiro.** Command hooks exist ([hooks](https://kiro.dev/docs/hooks/)), but the
  documentation disagrees with itself on event names and on whether `stop` ends a turn or
  a session, the user-level location is mentioned once, and there is no approval event.
- **Augment (Auggie CLI).** Documented hooks ([hooks](https://docs.augmentcode.com/cli/hooks))
  that, in the published CLI, run only when a server-side flag is on for the account, which
  cannot be checked from here.
- **Amp** and **OpenCode.** No command hooks: both have plugins written in TypeScript that
  run inside the agent ([Amp](https://ampcode.com/docs/markdown/customize/plugins),
  [OpenCode](https://opencode.ai/docs/plugins/)), and neither has a session end. A small
  plugin could hand events to `hook.mjs`; that is a different kind of integration, not
  written yet.
- **Aider.** Only `--notifications-command`, a command run with no input when Aider
  waits for the listener ([notifications](https://aider.chat/docs/usage/notifications.html));
  it cannot tell a finished answer from a question, or anything else.
- **Copilot's cloud agent** reads hooks only from a repository's `.github/hooks`, in a
  sandbox that cannot reach the relay; it is not heard.

## What has not been seen working

Every hook script is checked by `pnpm integrations:check`, which feeds it events in
the documented shape against a stand-in relay, and every `install.mjs` is run against a
configuration with other hooks in it.

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

Gemini CLI, Copilot CLI, Qwen Code and Droid, all of it still open, since none of them
was run:
- That each runs the hooks as written: the events' names, the payloads' fields, the
  matchers, the timeouts' units.
- Gemini CLI: installing the extension from a local path, and `${extensionPath}` in its
  hook commands (from source, not tried); whether user-level hooks in settings run in a
  folder that is not trusted.
- Copilot CLI: whether a failed shell command runs `postToolUseFailure`; whether
  `${PLUGIN_ROOT}` is replaced in a plugin's hook commands; what VS Code does with the
  camelCase entries in `~/.copilot/hooks`.
- Qwen Code: that `submitted_prompt` comes with every message typed in the terminal
  interface; installing the folder as an extension.
- Droid: whether a subagent's tools come under the parent's `session_id`; the plugin
  through `.factory-plugin/marketplace.json`; the order of `SessionStart` and the first
  `UserPromptSubmit`.

Windows has not been tried for any of them.
