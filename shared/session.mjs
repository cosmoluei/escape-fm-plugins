// What every integration has in common: a session's two tags, kept between hook
// runs and reported when they change, and whether the agent's steps went through.
// Each agent's hook script turns that agent's own events into the steps below;
// nothing else of an event is passed in here, so nothing else can leave.

import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { classify, fromTools } from './classify.mjs'
import { computerName } from './computer.mjs'
import { HOME, headless, loadConfig, openBrowser, pairingUrl, post, postDetached, readJson, welcomed, writeJson } from './lib.mjs'

/** While nothing changes, a running agent still says so this often, so the relay knows it is alive. */
const HEARTBEAT = 45_000
const TOOL_WINDOW = 24
/** Outcomes held for the next report; the relay takes no more than this from one. */
const OUTCOMES = 32

const started = Date.now()

/**
 * One thing that happened in a session.
 * @typedef {object} Step
 * @property {string} id the agent's own session id; it stays local, the relay sees a digest of it
 * @property {'start' | 'prompt' | 'tool' | 'running' | 'waiting' | 'stop' | 'end'} kind
 *   start: the session began. prompt: the listener sent a message. tool: a tool is starting.
 *   running: the agent is at work again. waiting: it is asking the listener something.
 *   stop: it has finished its turn. end: the session is over.
 *   A tool finishing is `running` (the agent is at work again), with `ok` when the agent says whether it went through,
 *   and with `tool` too from an agent whose hooks are not told when a tool starts.
 * @property {string} [prompt] with 'prompt': read here to choose the work mode, and not sent anywhere
 * @property {boolean} [planning] with 'prompt': the agent is in its plan mode
 * @property {'edit' | 'read' | 'ask' | 'other'} [tool] with 'tool', or 'running' for a tool that has finished: what kind of tool it is
 * @property {boolean} [ok] with 'running', when a step of the agent's has just finished: whether it went through.
 *   Only this yes or no is kept and reported, never what the step was or what it said; reading and asking are
 *   not steps here, so a hook script leaves `ok` out for them.
 */

/**
 * How an agent needs its reports made.
 * @typedef {object} Manner
 * @property {boolean} [detach] the agent waits for this hook, so return without waiting for the relay
 * @property {boolean} [known] only a start or a prompt may open a session; anything else about a
 *   session never seen is dropped. For an agent whose helpers report under ids of their own.
 */

/** @typedef {{ opened: boolean, reached: boolean | null }} FirstRun reached is null when nobody waited to find out */

/**
 * Reports a step if it changed anything.
 * @param {Step} step
 * @param {Manner} [manner]
 * @returns {Promise<FirstRun | null>} on this machine's first run, what came of it, for the hook script to tell the listener
 */
export async function report(step, manner = {}) {
  const session = createHash('sha256').update(String(step.id)).digest('base64url').slice(0, 16)
  const stateFile = path.join(HOME, 'sessions', `${session}.json`)
  const opens = step.kind === 'start' || step.kind === 'prompt'
  if (manner.known && !opens && step.kind !== 'end' && !existsSync(stateFile)) return null

  const config = loadConfig()
  const send = (body) => (manner.detach ? (postDetached(body), null) : post(config, body))
  const state = readJson(stateFile, { mode: null, agent: 'idle', tools: [], outcomes: [], sent: null })

  if (step.kind === 'end') {
    rmSync(stateFile, { force: true })
    await send({ session, end: true, ts: started })
    return null
  }

  let force = false
  switch (step.kind) {
    case 'start':
      state.agent = 'idle'
      force = true
      break
    case 'prompt': {
      // read here, classified here, and not sent anywhere
      const hint = classify(step.prompt, step.planning ? 'plan' : undefined)
      state.hinted = hint !== null
      state.mode = hint ?? state.mode ?? 'deep'
      state.agent = 'user'
      state.tools = []
      force = true
      break
    }
    case 'tool':
      state.tools = [...state.tools, String(step.tool)].slice(-TOOL_WINDOW)
      state.agent = step.tool === 'ask' ? 'waiting' : 'running'
      // the prompt gave no hint, so what the agent does decides
      if (!state.hinted) state.mode = fromTools(state.tools) ?? state.mode
      break
    case 'running':
      state.agent = 'running'
      if (step.tool) {
        state.tools = [...state.tools, String(step.tool)].slice(-TOOL_WINDOW)
        if (!state.hinted) state.mode = fromTools(state.tools) ?? state.mode
      }
      // kept until the next report goes, which carries them; they do not make one go sooner
      if (typeof step.ok === 'boolean') state.outcomes = [...(state.outcomes ?? []), step.ok].slice(-OUTCOMES)
      break
    case 'waiting':
      state.agent = 'waiting'
      break
    case 'stop':
      state.agent = 'idle'
      force = true
      break
    default:
      return null
  }

  const sent = state.sent
  const due = force || !sent || sent.agent !== state.agent || sent.mode !== state.mode || started - sent.at > HEARTBEAT
  const outcomes = due ? (state.outcomes ?? []) : []
  if (due) {
    state.sent = { agent: state.agent, mode: state.mode, at: started }
    state.outcomes = []
  }
  writeJson(stateFile, state)
  if (!due) return null

  // the machine's name too, so the listener's page can say which computer this is (computer.mjs)
  const computer = computerName()
  const reply = await send({
    session,
    mode: state.mode,
    agent: state.agent,
    ts: started,
    ...(outcomes.length ? { outcomes } : {}),
    ...(computer ? { computer } : {}),
  })
  if (step.kind !== 'start') return null
  return greet(config, manner.detach ? null : reply !== null)
}

/**
 * First run on this machine: open the player already paired, so there is no code to type.
 * Called by itself by an agent whose session start is not a moment to report anything.
 * @returns {FirstRun | null} null when this machine has been through it already
 */
export function greet(config = loadConfig(), reached = null) {
  if (!config.firstRun) return null
  const opened = !process.env.ESCAPE_FM_NO_OPEN && !headless() && openBrowser(pairingUrl(config))
  welcomed()
  return { opened, reached }
}

/**
 * What to tell the listener after a first run.
 * @param {FirstRun} first
 * @param {string} otherwise how to open the player from this agent, for when no browser was opened
 */
export function welcome(first, otherwise) {
  const message = first.opened
    ? 'escape.fm: opened the player in your browser, already paired with this machine. Press play there.'
    : `escape.fm is set up. ${otherwise}`
  return first.reached === false ? `${message} (The relay could not be reached just now.)` : message
}
