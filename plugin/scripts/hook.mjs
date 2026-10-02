#!/usr/bin/env node
// Runs on Claude Code hook events and reports two tags for this session: the work
// mode and the agent state, and whether each of the agent's steps went through. That,
// a random session id and a timestamp are everything that leaves the machine. See README.md.
//
// This file is the Claude Code part: which of its events mean what. The rest is
// shared with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).

import { readFileSync } from 'node:fs'
import { report, welcome } from './session.mjs'

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READ = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch', 'LSP'])
/** Tools that are the agent asking the listener something. */
const ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])
/**
 * The end of a turn and of a session. Claude Code waits for these hooks (a background
 * Stop hook still pending when `claude -p` exits keeps SessionEnd from running at all,
 * and SessionEnd hooks are stopped after about a second and a half), so their reports
 * are handed to a process of their own and the hook returns at once.
 */
const HURRIED = new Set(['Stop', 'StopFailure', 'SessionEnd'])

/** Only the name of a tool is looked at, never what it is given or what it returns. */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/**
 * A finished tool as a step of the agent's: whether it went through, which Claude Code says by the
 * event it runs (PostToolUseFailure or PostToolUse), never by anything the tool returned. Reading
 * and asking are not steps: a search that finds nothing is not the agent failing.
 */
const outcome = (name, ok) => (['edit', 'other'].includes(kindOf(name)) ? ok : undefined)

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      return { id, kind: 'start' }
    case 'UserPromptSubmit':
      return { id, kind: 'prompt', prompt: input.prompt, planning: input.permission_mode === 'plan' }
    case 'PreToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'PostToolUse':
      return { id, kind: 'running', ok: outcome(input.tool_name, true) }
    case 'PostToolUseFailure':
      // a tool the listener stopped did not fail; the turn is ending, of which no hook tells
      return input.is_interrupt === true ? null : { id, kind: 'running', ok: outcome(input.tool_name, false) }
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

  const first = await report(step, { detach: HURRIED.has(input.hook_event_name) })
  if (first) {
    process.stdout.write(JSON.stringify({ systemMessage: welcome(first, 'Run /escape-fm:open to open the player paired with this machine.') }))
  }
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
