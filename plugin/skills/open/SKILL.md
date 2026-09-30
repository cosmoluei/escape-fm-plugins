---
name: open
description: Open the escape.fm player in the browser, paired with this machine. Use only when the user asks to open or reconnect the escape.fm player.
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command and relay its one line of output to the user. Do not add `--print`: the link it would print carries a private key that should not enter the conversation.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/open.mjs"
```
