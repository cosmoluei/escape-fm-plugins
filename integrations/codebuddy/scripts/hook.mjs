#!/usr/bin/env node
// Runs on CodeBuddy Code and WorkBuddy hook events and reports two tags for this session:
// the work mode and the agent state, and whether each of the agent's steps went through.
// That, a random session id and a timestamp are everything that leaves the machine. See README.md.
//
// This file is the part for Tencent's two agents, which run the same engine and the same hooks
// (WorkBuddy's is CodeBuddy Code inside the desktop app): which of their events mean what.
// integrations/workbuddy/scripts/hook.mjs is a copy of it. The rest is shared with the other
// agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// CodeBuddy waits for every hook and documents no background option, so each report is handed
// to a process of its own and the hook returns at once.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { report, welcome } from './session.mjs'

const EDIT = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const READ = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebSearch', 'WebFetch'])
/** Tools that are the agent asking the listener something. */
const ASK = new Set(['AskUserQuestion', 'ExitPlanMode'])

/** Only the name of a tool is looked at, never what it is given or what it returns. */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/**
 * A finished tool as a step of the agent's: whether it went through, which CodeBuddy says by the
 * event it runs (PostToolUseFailure or PostToolUse), never by anything the tool returned. Reading
 * and asking are not steps: a search that finds nothing is not the agent failing.
 */
const outcome = (name, ok) => (['edit', 'other'].includes(kindOf(name)) ? ok : undefined)

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      // after a compaction, which can come in the middle of a turn, the turn carries on
      return input.source === 'compact' ? null : { id, kind: 'start' }
    case 'UserPromptSubmit':
      return { id, kind: 'prompt', prompt: input.prompt, planning: input.permission_mode === 'plan' }
    case 'PreToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'PostToolUse':
      return { id, kind: 'running', ok: outcome(input.tool_name, true) }
    case 'PostToolUseFailure':
      // a tool the listener stopped did not fail
      return input.is_interrupt === true ? null : { id, kind: 'running', ok: outcome(input.tool_name, false) }
    case 'PermissionRequest':
      return { id, kind: 'waiting' }
    case 'Notification':
      return ['permission_prompt', 'elicitation_dialog'].includes(input.notification_type) ? { id, kind: 'waiting' } : null
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

  const first = await report(step, { detach: true })
  if (first) {
    // shown to the listener and not given to the model, as `systemMessage` is documented to be
    const open = path.join(path.dirname(fileURLToPath(import.meta.url)), 'open.mjs')
    process.stdout.write(JSON.stringify({ systemMessage: welcome(first, `To open the player paired with this machine, run in your own terminal: node "${open}"`) }))
  }
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
