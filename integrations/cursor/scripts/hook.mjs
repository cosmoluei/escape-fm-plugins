#!/usr/bin/env node
// Runs on Cursor hook events and reports two tags for this conversation: the work
// mode and the agent state, whether each of the agent's steps went through and how many
// of each kind there were, and, only when the listener has asked for them, the lines of
// code of the conversation's work. That, a random session id and a timestamp are
// everything that leaves the machine. See README.md.
//
// This file is the Cursor part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// Cursor waits for a hook before it goes on, and reads what a hook prints as an
// answer. So this prints nothing, which leaves every decision to Cursor, and hands
// each report to a process of its own instead of waiting for the relay.

import { readFileSync } from 'node:fs'
import { stepOf } from './classify.mjs'
import { greet, report } from './session.mjs'

const EDIT = new Set(['Write'])
const READ = new Set(['Read', 'Grep', 'WebSearch', 'WebFetch'])
/**
 * The agent asking the listener something. Cursor's documentation does not list its
 * question tool among the names a hook is given; if it arrives under this name the
 * session shows as waiting, and if it does not, nothing is lost.
 */
const ASK = new Set(['AskQuestion'])
/** The shell. */
const SHELL = new Set(['Shell'])

/**
 * Of a tool, only its name is looked at, and for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs); nothing of either leaves the
 * machine, only the kind of step. What a tool is given otherwise, and what it returns, is not read.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** A finished tool's kind of step: for the shell, from its command, which goes no further. */
const stepFor = (input) => stepOf(kindOf(input.tool_name), SHELL.has(input.tool_name) ? String(input.tool_input?.command ?? '') : undefined)

/**
 * A finished tool as a step of the agent's: whether it went through, which Cursor says by the event
 * it runs, never by anything the tool returned. Reading and asking are not steps.
 */
const outcome = (name, ok) => (['edit', 'other'].includes(kindOf(name)) ? ok : undefined)

/** @returns {import('./session.mjs').Step | null} */
function toStep(event, input) {
  const id = input.conversation_id ?? input.session_id
  if (!id) return null
  switch (event) {
    case 'beforeSubmitPrompt':
      return { id, kind: 'prompt', prompt: input.prompt }
    case 'preToolUse':
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'postToolUse':
      return { id, kind: 'running', ok: outcome(input.tool_name, true), step: stepFor(input) }
    case 'postToolUseFailure':
      // a tool stopped by the listener is the turn ending, which `stop` reports
      if (input.is_interrupt) return null
      // and one the listener would not allow did not fail, and is no step: only an error or a timeout is the agent's
      if (input.failure_type === 'permission_denied') return { id, kind: 'running' }
      return { id, kind: 'running', ok: outcome(input.tool_name, false), step: stepFor(input) }
    case 'stop':
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
  // hooks.json names the event on the command line; what Cursor sends says it too
  const event = process.argv[2] ?? input.hook_event_name

  // A new conversation says nothing about work yet, and Cursor starts it alongside
  // its first message: reporting both would let the start overtake the message.
  // It is only the moment to open the player, the first time on this machine.
  if (event === 'sessionStart') return void greet()

  const step = toStep(event, input)
  // where git counts the lines of code, when the listener has asked for them; never sent
  const folder = input.cwd ?? input.workspace_roots?.[0]
  if (step && typeof folder === 'string') step.cwd = folder
  // Only a message from the listener opens a session here: a subagent's tools may
  // arrive under an id of its own, and would linger as a session nobody ends.
  if (step) return report(step, { detach: true, known: true })
}

// A music plugin must never get in the way of the work: every failure is silent.
Promise.resolve()
  .then(main)
  .catch(() => {})
