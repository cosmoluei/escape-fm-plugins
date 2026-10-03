#!/usr/bin/env node
// Runs on Codex hook events and reports two tags for this session: the work mode
// and the agent state, how many of the agent's steps there were of each kind, and,
// only when the listener has asked for them, the lines of code of the session's work.
// That, a random session id and a timestamp are everything that leaves the machine.
// See README.md.
//
// This file is the Codex part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stepOf } from './classify.mjs'
import { report, welcome } from './session.mjs'

/**
 * Codex edits files with one tool. It reads them with shell commands, whose command is looked at
 * only to tell a test run or a commit, so no tool counts as reading.
 */
const EDIT = new Set(['apply_patch'])
/** Tools that are the agent asking the listener something. */
const ASK = new Set(['request_user_input', 'request_permissions'])
/** The shell. Its command comes as a string, or as the list of a program's arguments. */
const SHELL = new Set(['Bash'])
/**
 * The end of a turn and of a session: their reports are handed to a process of their own
 * and the hook returns at once. Codex gives Interrupt and SessionEnd three seconds at most,
 * and a background hook still running when a session ends is dropped, which in `codex exec`
 * is every Stop; so Stop is run in the foreground, and returns as quickly.
 */
const HURRIED = new Set(['Stop', 'Interrupt', 'SessionEnd'])

/**
 * Of a tool, only its name is looked at, and for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs); nothing of either leaves the
 * machine, only the kind of step. What a tool is given otherwise, and what it returns, is not read.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : 'other')

function commandOf(input) {
  if (!SHELL.has(input.tool_name)) return undefined
  const command = input.tool_input?.command
  return Array.isArray(command) ? command.map(String).join(' ') : String(command ?? '')
}

/** A finished tool's kind of step: for the shell, from its command, which goes no further. */
const stepFor = (input) => stepOf(kindOf(input.tool_name), commandOf(input))

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
      // no outcome (README.md), but a step: Codex runs this for every tool that finished, failed or not
      return { id, kind: 'running', step: stepFor(input) }
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
  // where git counts the lines of code, when the listener has asked for them; never sent
  if (typeof input.cwd === 'string') step.cwd = input.cwd

  const first = await report(step, { detach: HURRIED.has(input.hook_event_name) })
  if (first) {
    const open = path.join(path.dirname(fileURLToPath(import.meta.url)), 'open.mjs')
    process.stdout.write(JSON.stringify({ systemMessage: welcome(first, `To open the player paired with this machine, run in your own terminal: node "${open}"`) }))
  }
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
