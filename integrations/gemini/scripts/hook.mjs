#!/usr/bin/env node
// Runs on Gemini CLI hook events and reports two tags for this session: the work mode
// and the agent state, whether each of the agent's steps went through, where Gemini
// CLI says, and how many of each kind there were, and, only when the listener has asked
// for them, the lines of code of the session's work. That, a random session id and a
// timestamp are everything that leaves the machine. See README.md.
//
// This file is the Gemini CLI part: which of its events mean what. The rest is shared
// with the other agents' integrations (session.mjs, classify.mjs, lib.mjs).
//
// Gemini CLI waits for every hook and reads what it prints as an answer, so this prints
// nothing but the one welcome, and hands each report to a process of its own.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stepOf } from './classify.mjs'
import { report, welcome } from './session.mjs'

const EDIT = new Set(['replace', 'write_file'])
const READ = new Set(['read_file', 'read_many_files', 'glob', 'grep_search', 'list_directory', 'web_fetch', 'google_web_search'])
/** The tool that asks the listener something. */
const ASK = new Set(['ask_user'])
/** A shell command: one that ran and exited with an error is not marked as an error, so only one that could not run is told. */
const SHELL = new Set(['run_shell_command'])

/**
 * Of a tool, only its name is looked at, for the shell its command, here and only to tell a test
 * run or a commit from any other command (`stepOf` in classify.mjs), and of its result whether it
 * has an error (below); nothing of any of it leaves the machine but the kind of step and the yes or no.
 */
const kindOf = (name) => (ASK.has(name) ? 'ask' : EDIT.has(name) ? 'edit' : READ.has(name) ? 'read' : 'other')

/** A finished tool's kind of step: for the shell, from its command, which goes no further. */
const stepFor = (input) => stepOf(kindOf(input.tool_name), SHELL.has(input.tool_name) ? String(input.tool_input?.command ?? '') : undefined)

/**
 * A finished tool as a step of the agent's: whether it went through. Of the tool's result only
 * whether it has an `error` is looked at, never the error or the output. A shell command without
 * one may still have failed, so it is no outcome. Reading and asking are not steps.
 */
function outcome(name, response) {
  if (!['edit', 'other'].includes(kindOf(name))) return undefined
  const failed = response !== null && typeof response === 'object' && response.error != null
  return failed ? false : SHELL.has(name) ? undefined : true
}

/** @returns {import('./session.mjs').Step | null} */
function toStep(input) {
  const id = input.session_id
  switch (input.hook_event_name) {
    case 'SessionStart':
      return { id, kind: 'start' }
    case 'BeforeAgent':
      return { id, kind: 'prompt', prompt: input.prompt }
    case 'BeforeTool':
      // before Gemini CLI asks for approval: a tool waiting on the listener says so below
      return { id, kind: 'tool', tool: kindOf(input.tool_name) }
    case 'AfterTool':
      return { id, kind: 'running', ok: outcome(input.tool_name, input.tool_response), step: stepFor(input) }
    case 'Notification':
      return input.notification_type === 'ToolPermission' ? { id, kind: 'waiting' } : null
    case 'AfterAgent':
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

  // a session's start is told in the foreground, so the first one can say whether the relay was reached
  const first = await report(step, { detach: step.kind !== 'start' })
  if (first) {
    const open = path.join(path.dirname(fileURLToPath(import.meta.url)), 'open.mjs')
    process.stdout.write(JSON.stringify({ systemMessage: welcome(first, `To open the player paired with this machine, run in your own terminal: node "${open}"`) }))
  }
}

// A music plugin must never get in the way of the work: every failure is silent.
main().catch(() => {})
