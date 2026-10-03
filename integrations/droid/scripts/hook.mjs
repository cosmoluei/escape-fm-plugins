#!/usr/bin/env node
// Runs on Factory Droid hook events and reports two tags for this session: the work mode
// and the agent state, how many of the agent's steps there were of each kind, and, only
// when the listener has asked for them, the lines of code of the session's work. That, a
// random session id and a timestamp are everything that leaves the machine. See README.md.
//
// This file is the Droid part: which of its events mean what. The rest is shared with the
// other agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// Droid waits for every hook, and what a hook prints at a session's start goes to the model,
// so this prints nothing and hands each report to a process of its own.

import { readFileSync } from 'node:fs'
import { stepOf } from './classify.mjs'
import { report } from './session.mjs'

const EDIT = new Set(['Edit', 'Create', 'ApplyPatch'])
const READ = new Set(['Read', 'LS', 'Glob', 'Grep', 'FetchUrl', 'WebSearch'])
/** The tool that asks the listener something. */
const ASK = new Set(['AskUser'])
/** The shell. */
const SHELL = new Set(['Execute'])

/**
 * Of a tool, only its name is looked at, and for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs); nothing of either leaves the
 * machine, only the kind of step. What a tool is given otherwise, and what it returns, is not read.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** A finished tool's kind of step: for the shell, from its command, which goes no further. */
const stepFor = (input) => stepOf(kindOf(input.tool_name), SHELL.has(input.tool_name) ? String(input.tool_input?.command ?? '') : undefined)

/**
 * @returns {import('./session.mjs').Step | null}
 * No outcomes: Droid documents `PostToolUse` as running after a tool succeeds and has no event
 * for one that fails, so a step that failed cannot be told from one that never finished.
 */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      return { id, kind: 'start' }
    case 'UserPromptSubmit':
      return { id, kind: 'prompt', prompt: input.prompt, planning: input.permission_mode === 'spec' }
    case 'PreToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'PostToolUse':
      return { id, kind: 'running', step: stepFor(input) }
    case 'Notification':
      // Droid sends `idle_prompt` instead of `Stop` when the listener stops a turn
      if (input.notification_type === 'idle_prompt') return { id, kind: 'stop' }
      return ['permission_prompt', 'elicitation_dialog'].includes(input.notification_type) ? { id, kind: 'waiting' } : null
    case 'Stop':
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
  // where git counts the lines of code, when the listener has asked for them; never sent
  if (step && typeof input.cwd === 'string') step.cwd = input.cwd
  // A start opens the player the first time on this machine; nothing is said about it, since
  // the listener would not see it. Only a start or a message opens a session: a subagent's
  // tools may arrive under an id of their own.
  if (step) await report(step, { detach: true, known: true })
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
