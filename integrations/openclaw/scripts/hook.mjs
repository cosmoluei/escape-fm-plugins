#!/usr/bin/env node
// Runs once for each OpenClaw event the plugin (../index.js) passes on, and reports two tags for
// the conversation: the work mode and the agent state, and whether each of the agent's steps went
// through. That, a random session id and a timestamp are everything that leaves the machine. See README.md.
//
// This file is the OpenClaw part: which of the plugin's events mean what. The rest is shared with
// the other agents' integrations (session.mjs, classify.mjs, lib.mjs). The plugin hands over only
// the conversation's key, the event, a tool's name and whether it failed: no message is read, so
// the work mode comes from what the agent does, never from what anyone wrote.

import { readFileSync } from 'node:fs'
import { greet, report } from './session.mjs'

const EDIT = new Set(['write', 'edit', 'apply_patch'])
const READ = new Set([
  'read',
  'web_search',
  'web_fetch',
  'memory_search',
  'memory_get',
  'sessions_list',
  'sessions_history',
  'session_status',
  'agents_list',
  'image',
  'pdf',
  'process',
])

/** Only the name of a tool is looked at, never what it is given or what it returns. OpenClaw asks the owner in its reply, not with a tool. */
const kindOf = (name) => (EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** A finished tool as a step: whether it went through, from whether OpenClaw reports an error. Reading is not a step. */
const outcome = (name, ok) => (kindOf(name) === 'read' ? undefined : ok)

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'message_received':
      // the owner wrote: the text is not passed on, so it says nothing of the work mode
      return { id, kind: 'prompt', prompt: '' }
    case 'run_start':
    case 'approval_resolved':
      return { id, kind: 'running' }
    case 'tool_start':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'tool_end':
      return { id, kind: 'running', ok: outcome(input.tool_name, input.failed !== true) }
    case 'approval_requested':
    case 'question':
      return { id, kind: 'waiting' }
    case 'run_end':
      return { id, kind: 'stop' }
    case 'session_end':
      return { id, kind: 'end' }
    default:
      return null
  }
}

async function main() {
  if (process.env.ESCAPE_FM_DISABLE) return
  const input = JSON.parse(readFileSync(0, 'utf8'))
  // the gateway started: the first time on this machine, the player opens, paired with it
  if (input.hook_event_name === 'gateway_start') return void greet()
  const step = input.session_id ? toStep(input) : null
  if (step) await report(step, { detach: true })
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
