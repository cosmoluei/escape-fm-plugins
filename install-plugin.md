# Installing escape.fm: a guide for the AI agent

You are an AI agent, and the person you work for asked you to install escape.fm. escape.fm is
background music that follows their work: a small plugin tells the escape.fm player whether the
agent is working, waiting for them or done, and the music follows. This guide is written for you.
Answer the person in their own language.

This guide is for escape.fm plugins 0.6.0. The plugins are open source:
https://github.com/escape-fm/plugins

## Before you change anything

- Show the person the commands you are about to run and what each one changes (listed for each
  agent below), and wait for their yes.
- Nothing here needs a password, an API key or a sign-in. If something asks for one, stop and
  tell the person.
- Do not pipe anything from the internet into a shell. Everything is installed from the public
  repository above, with `git` and `node`.
- Check that Node.js 18 or later is installed (`node --version`). For every agent except Claude
  Code and Codex, also check that `git` is installed (`git --version`). If either is missing, tell
  the person and stop.

## Step 1: which agent are you?

You know which product you are. Find it in this list:

| Agent | Section |
| --- | --- |
| Claude Code (Anthropic) | [Claude Code](#claude-code) |
| Codex (OpenAI: CLI, IDE extension, app) | [Codex](#codex) |
| Cursor (the editor, or its `agent` CLI) | [Cursor](#cursor) |
| Gemini CLI (Google) | [Gemini CLI](#gemini-cli) |
| GitHub Copilot CLI | [Copilot CLI](#copilot-cli) |
| Qwen Code | [Qwen Code](#qwen-code) |
| Factory Droid | [Droid](#droid) |
| CodeBuddy Code (Tencent) | [CodeBuddy](#codebuddy) |
| WorkBuddy (Tencent) | [WorkBuddy](#workbuddy) |
| Muse Code (Meta) | [Muse Code](#muse-code) |
| OpenClaw | [OpenClaw](#openclaw) |
| Muse (Meta's app), ChatGPT and its dots, Grok and Grok Bot: cloud agents | [Cloud agents](#cloud-agents-muse-chatgpt-and-dots-grok) |

If you are none of these, tell the person that escape.fm does not support you yet, and that
https://github.com/escape-fm/plugins lists the agents it does support. Then stop. If you are not
sure which you are, ask the person.

## Step 2: install

Most agents install from a copy of the repository kept in `~/.escape-fm/plugins`. Where a section
says "Get the repository", run:

```bash
git clone --depth 1 https://github.com/escape-fm/plugins ~/.escape-fm/plugins
```

If that folder is there already, update it instead: `git -C ~/.escape-fm/plugins pull`.

Every `install.mjs` below copies the hook scripts to a folder of their own under `~/.escape-fm`
and adds escape.fm's hooks to the agent's configuration file, beside everything already in it.
Running it again updates it; `--uninstall` takes out exactly what it added; `--print` shows the
change without making it.

### Claude Code

```bash
claude plugin marketplace add escape-fm/plugins
claude plugin install escape-fm@escape-fm
```

Changes: adds the escape-fm marketplace and installs its plugin into Claude Code's plugin folder.
Next: the person starts a new session. To get new versions by themselves, they turn on
auto-update: `/plugin` → Marketplaces → escape-fm → Enable auto-update.

Optional, and only if the person wants Claude Code's tokens and cost counted ("Tokens and cost"
on their page in escape.fm): Claude Code tells only its status line what a session costs, and a
plugin cannot set one up. Ask first, then run, with the plugin's folder (Claude Code keeps it
under `~/.claude/plugins/cache/escape-fm/escape-fm/`, in a folder named for its version):

```bash
node <the plugin's folder>/scripts/statusline.mjs --install
```

It copies the status line to `~/.escape-fm/statusline.mjs` and prints a `statusLine` setting.
Show the person that setting and, after their yes, add it to `~/.claude/settings.json`. It
replaces any status line they already have: if there is one, say so and let them choose.

### Codex

```bash
codex plugin marketplace add escape-fm/plugins
codex plugin add escape-fm@escape-fm
```

Changes: adds the escape-fm marketplace and installs its plugin into `~/.codex/plugins`.
Next: **Codex runs no hook until the person trusts it.** Ask them to run `/hooks` in Codex and
trust the escape.fm hooks, then start a new session.

### Cursor

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/cursor/install.mjs
```

Changes: `~/.cursor/hooks.json`. Next: Cursor picks the hooks up by itself; the person starts a
new conversation.

### Gemini CLI

Get the repository, then:

```bash
gemini extensions install ~/.escape-fm/plugins/integrations/gemini
```

Changes: installs the escape-fm extension into Gemini CLI. It asks the person to confirm the
extension's hooks; if you cannot answer that prompt, ask the person to run the command in their own
terminal. Next: the person starts Gemini CLI again.

### Copilot CLI

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/copilot/install.mjs
```

Changes: writes `~/.copilot/hooks/escape-fm.json`, a file of its own. Next: the person starts a
new session.

### Qwen Code

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/qwen/install.mjs
```

Changes: `~/.qwen/settings.json`. Next: the person starts Qwen Code again.

### Droid

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/droid/install.mjs
```

Changes: `~/.factory/hooks.json` (or the hooks in `~/.factory/settings.json`, if the person keeps
them there). Next: the person starts Droid again.

### CodeBuddy

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/codebuddy/install.mjs
```

Changes: `~/.codebuddy/settings.json` (or `$CODEBUDDY_CONFIG_DIR/settings.json`). Next: the
person starts CodeBuddy again.

### WorkBuddy

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/workbuddy/install.mjs
```

Changes: `~/.workbuddy/settings.json` (or `$WORKBUDDY_CONFIG_DIR/settings.json`). Next: WorkBuddy
reads its hooks only when it starts, so the person quits it completely and opens it again.

### Muse Code

Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/muse/install.mjs
```

Changes: `~/.config/muse/settings.json` (or `$XDG_CONFIG_HOME/muse/settings.json`). Next: the
person starts a new session.

### OpenClaw

Run this on the machine the OpenClaw gateway runs on. Get the repository, then:

```bash
node ~/.escape-fm/plugins/integrations/openclaw/install.mjs
```

Changes: copies the plugin to `~/.escape-fm/openclaw` and runs
`openclaw plugins install --link ~/.escape-fm/openclaw`, which adds it to the plugins in
OpenClaw's configuration. Next: the gateway loads it when it restarts
(`openclaw gateway restart`). Restarting the gateway ends the run you are in, so say so and let the
person choose when.

## Step 3: check it, and what the person does next

- Check that the command finished without an error. For an `install.mjs`, check that
  `~/.escape-fm/<agent>/hook.mjs` exists (`<agent>` is the folder name in the command: `cursor`,
  `qwen`, …; for OpenClaw, `~/.escape-fm/openclaw/scripts/hook.mjs`). For Claude Code, check that
  `claude plugin list` lists `escape-fm`; for Codex, that `/plugins` does.
- Tell the person what they have to do in their agent (the "Next" above).
- Then, at the first session afterwards, the escape.fm player opens in their browser, already
  paired with this computer. They press play there. If they are signed in to escape.fm in that
  browser, the computer is added to their account at once and shows under "Computers" on their
  page, by the computer's name; if they sign in there later, it is added then. Their phone (the
  escape.fm app, signed in to the same account) hears it too.
- The pairing link carries this computer's private listener key. Do not print it, open it
  yourself or paste it into the conversation. On a computer with no screen (a server, a session over
  SSH), ask the person to run `node ~/.escape-fm/<agent>/open.mjs --print` in their own terminal
  (OpenClaw: `node ~/.escape-fm/openclaw/scripts/open.mjs --print`; Claude Code: `/escape-fm:open`)
  and to open the link it prints on the device they listen on.

## Cloud agents (Muse, ChatGPT and dots, Grok)

A cloud agent runs on its company's computers, so there is nothing to install. It connects to
escape.fm's MCP server and tells it only whether it is working for you, waiting for you or done,
never what the task is. It never changes the music: when it waits for you, escape.fm can remind you
on your phone; when it's done, a warm drop falls in the player.

The server: `https://api.escape.fm/mcp` (Streamable HTTP, OAuth). The listener signs in to
escape.fm and allows the agent on a page escape.fm shows; an agent cannot link itself.

- **Grok and Grok Bot:** grok.com → Connectors → Custom. Name `escape.fm`, URL
  `https://api.escape.fm/mcp`, then Connect, sign in to escape.fm and Allow.
- **ChatGPT and dots:** in ChatGPT's settings turn on developer mode, add an app with URL
  `https://api.escape.fm/mcp` and OAuth, then sign in to escape.fm and Allow. (Once escape.fm is in
  ChatGPT's plugin directory, connect it from there instead.)
- **Muse:** add a custom connector with URL `https://api.escape.fm/mcp`, then sign in to escape.fm
  and Allow. (Once escape.fm is in Muse's connector directory, connect it from there instead.)

If you are an agent reading this for the user: you cannot finish this yourself. Give the user the
steps for their agent and the URL. Once connected, call `escape_fm_status` with `working` when you
begin a longer task for the user, `waiting` when you need them, `done` when you finish and `idle` if
you stop; pass the same short `task` id for one task and nothing about the task itself.

The linked agent shows on the listener's page in escape.fm under Cloud agents, where it can be
unlinked.

## What it sends, and what it never sends

On the agent's events, for each session, the plugin sends escape.fm:

- a digest of the session's id, so sessions can be told apart;
- one of eight work modes, chosen on this computer from keywords in the person's message (OpenClaw:
  from the tools the agent uses);
- the agent's state: the person typing, the agent working, the agent waiting for the person, or
  idle;
- the time;
- this computer's name as its owner set it (`ESCAPE_FM_COMPUTER_NAME` changes it, set to nothing
  it sends none);
- whether each of the agent's steps (a command, an edit, a tool) succeeded or failed, as `true` or
  `false` only, never what the step was;
- how many of the agent's steps were of each kind: an edit, a command, a test run, a search, a
  commit, or another tool, as counts only (a shell command is looked at on this computer only to
  tell a test run or a commit, and is never sent);
- only if the person has switched them on, on their page in escape.fm ("Lines of code", "Tokens
  and cost", under the history section): the lines added and removed and the commits made, counted
  with git in the folder the agent works in, and the tokens and cost of the agent's work where the
  agent can tell (Claude Code with the status line above, OpenClaw). Both are off until then;
- and, as the request's User-Agent, which plugin and version sent it.

It never sends prompts or messages, replies, code, file names, paths, commands, commit messages,
diffs, their output or error messages. The message is read on this computer only to choose the work mode, and is not
stored. Privacy policy: https://escape.fm/privacy

`ESCAPE_FM_DISABLE=1` in the environment turns the plugin off without uninstalling it.

## Updating

- Claude Code: auto-update on, as above, or `claude plugin update escape-fm@escape-fm`.
- Codex: `codex plugin remove escape-fm@escape-fm`, then the two install commands again, and trust
  the hooks again in `/hooks`.
- Gemini CLI: `git -C ~/.escape-fm/plugins pull`, then `gemini extensions update escape-fm`.
- Every other agent: `git -C ~/.escape-fm/plugins pull`, then run the same `install.mjs` again.

## Uninstalling

- Claude Code: `claude plugin uninstall escape-fm@escape-fm`
- Codex: `codex plugin remove escape-fm@escape-fm`
- Gemini CLI: `gemini extensions uninstall escape-fm`
- Every other agent: the same `install.mjs` with `--uninstall`, for example
  `node ~/.escape-fm/plugins/integrations/cursor/install.mjs --uninstall`.

The pairing key stays in `~/.escape-fm/config.json`, shared by every agent on the computer. To
remove escape.fm from the computer altogether, uninstall each agent's plugin, then delete
`~/.escape-fm`.
