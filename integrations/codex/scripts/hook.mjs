#!/usr/bin/env node
// Runs on Codex hook events and reports two tags for this session: the work mode
// and the agent state. That, a random session id and a timestamp are everything
// that leaves the machine. See README.md.
//
// This file is the Codex part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { report, welcome } from './session.mjs'

/** Codex edits files with one tool. It reads them with shell commands, which are not looked into, so no tool counts as reading. */
const EDIT = new Set(['apply_patch'])
/** Tools that are the agent asking the listener something. */
const ASK = new Set(['request_user_input', 'request_permissions'])
/**
 * The end of a turn and of a session: their reports are handed to a process of their own
 * and the hook returns at once. Codex gives Interrupt and SessionEnd three seconds at most,
 * and a background hook still running when a session ends is dropped, which in `codex exec`
 * is every Stop; so Stop is run in the foreground, and returns as quickly.
 */
const HURRIED = new Set(['Stop', 'Interrupt', 'SessionEnd'])

/** Only the name of a tool is looked at, never what it is given or what it returns. */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : 'other')

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      // after a compaction the turn carries on: that is not an agent gone idle
      return input.source === 'compact' ? null : { id, kind: 'start' }
    case 'UserPromptSubmit':
      // A subagent reports under the session that started it, and its prompt is that
      // session's agent talking, not the listener: it is not read, and means work goes on.
      if (input.agent_id) return { id, kind: 'running' }
      return { id, kind: 'prompt', prompt: input.prompt, planning: input.permission_mode === 'plan' }
    case 'PreToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'PostToolUse':
      return { id, kind: 'running' }
    case 'PermissionRequest':
      return { id, kind: 'waiting' }
    case 'Stop':
    case 'Interrupt':
      return { id, kind: 'stop' }
    case 'SessionEnd':
      return { id, kind: 'end' }
    default:
      return null
  }
}

async function main() {
  if (process.env.ESCAPE_FM_DISABLE) return
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const step = input.session_id ? toStep(input) : null
  if (!step) return

  const first = await report(step, { detach: HURRIED.has(input.hook_event_name) })
  if (first) {
    const open = path.join(path.dirname(fileURLToPath(import.meta.url)), 'open.mjs')
    process.stdout.write(JSON.stringify({ systemMessage: welcome(first, `To open the player paired with this machine, run in your own terminal: node "${open}"`) }))
  }
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
