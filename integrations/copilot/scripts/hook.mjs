#!/usr/bin/env node
// Runs on GitHub Copilot CLI hook events and reports two tags for this session: the work
// mode and the agent state, whether each of the agent's steps went through and how many of
// each kind there were, and, only when the listener has asked for them, the lines of code of
// the session's work. That, a random session id and a timestamp are everything that leaves
// the machine. See README.md.
//
// This file is the Copilot CLI part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// Copilot CLI waits for every hook, so this prints nothing and hands each report to a
// process of its own. It does not listen to `preToolUse`: there a hook that fails to start
// (no `node` on the PATH, say) denies the tool, and a music plugin must never stop the work.
// A tool is heard of when it has finished instead.

import { readFileSync } from 'node:fs'
import { stepOf } from './classify.mjs'
import { greet, report } from './session.mjs'

const EDIT = new Set(['edit', 'create', 'str_replace_editor', 'apply_patch'])
const READ = new Set(['view', 'glob', 'grep', 'rg', 'web_fetch', 'web_search'])
/** The tool that asks the listener something. */
const ASK = new Set(['ask_user'])
/** The shell, on macOS and Linux and on Windows. */
const SHELL = new Set(['bash', 'powershell'])

/**
 * Of a tool, only its name is looked at, and for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs); nothing of either leaves the
 * machine, only the kind of step. What a tool is given otherwise, and what it returns, is not read.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** The shell's command: in `toolArgs`, a JSON string, or in snake_case `tool_input`. */
function commandOf(input, tool) {
  if (!SHELL.has(tool)) return undefined
  let args = input.toolArgs
  if (typeof args === 'string') {
    try {
      args = JSON.parse(args)
    } catch {
      args = null
    }
  }
  const command = args?.command ?? input.tool_input?.command
  return typeof command === 'string' ? command : ''
}

/**
 * A finished tool as a step of the agent's: whether it went through, which Copilot CLI says by
 * the event it runs, never by anything the tool returned. Reading and asking are not steps.
 */
const outcome = (name, ok) => (['edit', 'other'].includes(kindOf(name)) ? ok : undefined)

/** @returns {import('./session.mjs').Step | null} */
function toStep(event, input) {
  // the events are named in camelCase in hooks.json, which gives camelCase fields; the snake_case ones are read too
  const id = input.sessionId ?? input.session_id
  const tool = input.toolName ?? input.tool_name
  if (!id) return null
  switch (event) {
    case 'userPromptSubmitted':
      return { id, kind: 'prompt', prompt: input.prompt }
    case 'postToolUse':
      return { id, kind: 'running', tool: kindOf(tool), ok: outcome(tool, true), step: stepOf(kindOf(tool), commandOf(input, tool)) }
    case 'postToolUseFailure':
      return { id, kind: 'running', tool: kindOf(tool), ok: outcome(tool, false), step: stepOf(kindOf(tool), commandOf(input, tool)) }
    case 'notification':
      return ['permission_prompt', 'elicitation_dialog'].includes(input.notification_type) ? { id, kind: 'waiting' } : null
    case 'agentStop':
      return { id, kind: 'stop' }
    case 'sessionEnd':
      return { id, kind: 'end' }
    default:
      return null
  }
}

function main() {
  if (process.env.ESCAPE_FM_DISABLE) return
  const input = JSON.parse(readFileSync(0, 'utf8'))
  // hooks.json names the event on the command line
  const event = process.argv[2]

  // A session's start says nothing about work yet, and what a hook prints there goes to the
  // model, not the listener. It is only the moment to open the player, the first time on this machine.
  if (event === 'sessionStart') return void greet()

  const step = toStep(event, input)
  // where git counts the lines of code, when the listener has asked for them; never sent
  if (step && typeof input.cwd === 'string') step.cwd = input.cwd
  // Only a message from the listener opens a session here: a subagent's tools may arrive under
  // an id of its own, and would linger as a session nobody ends.
  if (step) return report(step, { detach: true, known: true })
}

// A music plugin must never get in the way of the work: every failure is silent.
Promise.resolve()
  .then(main)
  .catch(() => {})
