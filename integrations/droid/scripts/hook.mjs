#!/usr/bin/env node
// Runs on Factory Droid hook events and reports two tags for this session: the work mode
// and the agent state. That, a random session id and a timestamp are everything that
// leaves the machine. See README.md.
//
// This file is the Droid part: which of its events mean what. The rest is shared with the
// other agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// Droid waits for every hook, and what a hook prints at a session's start goes to the model,
// so this prints nothing and hands each report to a process of its own.

import { readFileSync } from 'node:fs'
import { report } from './session.mjs'

const EDIT = new Set(['Edit', 'Create', 'ApplyPatch'])
const READ = new Set(['Read', 'LS', 'Glob', 'Grep', 'FetchUrl', 'WebSearch'])
/** The tool that asks the listener something. */
const ASK = new Set(['AskUser'])

/** Only the name of a tool is looked at, never what it is given or what it returns. */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

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
      return { id, kind: 'running' }
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
  // A start opens the player the first time on this machine; nothing is said about it, since
  // the listener would not see it. Only a start or a message opens a session: a subagent's
  // tools may arrive under an id of their own.
  if (step) await report(step, { detach: true, known: true })
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
