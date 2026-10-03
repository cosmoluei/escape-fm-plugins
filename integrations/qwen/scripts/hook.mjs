#!/usr/bin/env node
// Runs on Qwen Code hook events and reports two tags for this session: the work mode
// and the agent state, whether each of the agent's steps went through and how many of
// each kind there were, and, only when the listener has asked for them, the lines of code
// of the session's work. That, a random session id and a timestamp are everything that
// leaves the machine. See README.md.
//
// This file is the Qwen Code part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stepOf } from './classify.mjs'
import { report, welcome } from './session.mjs'

const EDIT = new Set(['edit', 'write_file'])
const READ = new Set(['read_file', 'read_many_files', 'grep_search', 'glob', 'list_directory', 'web_fetch', 'web_search'])
/** The tool that asks the listener something. */
const ASK = new Set(['ask_user_question'])
/** The shell. */
const SHELL = new Set(['run_shell_command'])
/**
 * The end of a turn and of a session: their reports are handed to a process of their own and
 * the hook returns at once. Qwen Code ends a background hook still running when it exits, so
 * these run in the foreground, and return as quickly.
 */
const HURRIED = new Set(['Stop', 'StopFailure', 'SessionEnd'])

/**
 * Of a tool, only its name is looked at, and for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs); nothing of either leaves the
 * machine, only the kind of step. What a tool is given otherwise, and what it returns, is not read.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** A finished tool's kind of step: for the shell, from its command, which goes no further. */
const stepFor = (input) => stepOf(kindOf(input.tool_name), SHELL.has(input.tool_name) ? String(input.tool_input?.command ?? '') : undefined)

/**
 * A finished tool as a step of the agent's: whether it went through, which Qwen Code says by the
 * event it runs (a shell command that exits with an error is a failure), never by anything the
 * tool returned. Reading and asking are not steps.
 */
const outcome = (name, ok) => (['edit', 'other'].includes(kindOf(name)) ? ok : undefined)

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      // after a compaction the turn carries on: that is not an agent gone idle
      return input.source === 'compact' ? null : { id, kind: 'start' }
    case 'UserPromptSubmit':
      // A subagent's prompt is the agent talking, not the listener: not read, and work goes on.
      if (input.agent_id) return { id, kind: 'running' }
      // Qwen Code runs this before every call to the model, with tool results too; only one that
      // carries `submitted_prompt` is the listener's own message, and only that is read.
      if (typeof input.submitted_prompt !== 'string') return null
      return { id, kind: 'prompt', prompt: input.submitted_prompt, planning: input.permission_mode === 'plan' }
    case 'PreToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'PostToolUse':
      return { id, kind: 'running', ok: outcome(input.tool_name, true), step: stepFor(input) }
    case 'PostToolUseFailure':
      // a tool the listener stopped did not fail, and is no step
      return input.is_interrupt === true ? null : { id, kind: 'running', ok: outcome(input.tool_name, false), step: stepFor(input) }
    case 'PermissionRequest':
    case 'Notification':
      return { id, kind: 'waiting' }
    case 'Stop':
    case 'StopFailure':
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
