// A copy of shared/session.mjs, written by scripts/sync-integrations.mjs. Edit it there.
// What every integration has in common: a session's two tags, kept between hook
// runs and reported when they change, whether the agent's steps went through and
// what kind each was, and, only when the listener has asked for them, the lines of
// code and the tokens and cost of the session's work. Each agent's hook script turns
// that agent's own events into the steps below; nothing else of an event is passed
// in here, so nothing else can leave.

import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { classify, fromTools } from './classify.mjs'
import { computerName } from './computer.mjs'
import { HOME, headless, loadConfig, openBrowser, pairingUrl, post, postDetached, readJson, readShare, welcomed, writeJson } from './lib.mjs'
import { baseline, growth } from './lines.mjs'

/** While nothing changes, a running agent still says so this often, so the relay knows it is alive. */
const HEARTBEAT = 45_000
const TOOL_WINDOW = 24
/** Outcomes held for the next report; the relay takes no more than this from one. */
const OUTCOMES = 32
/** The kinds of step a report counts (docs/integrations.md, "Steps"); the relay takes no more than this many of each from one. */
const STEP_KINDS = ['edit', 'command', 'test', 'search', 'commit', 'other']
const STEPS = 1000
/** The most tokens, and dollars, one report may carry; the relay takes no more. */
const TOKENS = 1e10
const COST = 1000

const started = Date.now()

/**
 * One thing that happened in a session.
 * @typedef {object} Step
 * @property {string} id the agent's own session id; it stays local, the relay sees a digest of it
 * @property {'start' | 'prompt' | 'tool' | 'running' | 'waiting' | 'stop' | 'end' | 'usage'} kind
 *   start: the session began. prompt: the listener sent a message. tool: a tool is starting.
 *   running: the agent is at work again. waiting: it is asking the listener something.
 *   stop: it has finished its turn. end: the session is over.
 *   usage: the agent said what a turn used (`usage`); it changes no tag.
 *   A tool finishing is `running` (the agent is at work again), with `ok` when the agent says whether it went through,
 *   and with `tool` too from an agent whose hooks are not told when a tool starts.
 * @property {string} [prompt] with 'prompt': read here to choose the work mode, and not sent anywhere
 * @property {boolean} [planning] with 'prompt': the agent is in its plan mode
 * @property {'edit' | 'read' | 'ask' | 'other'} [tool] with 'tool', or 'running' for a tool that has finished: what kind of tool it is
 * @property {boolean} [ok] with 'running', when a step of the agent's has just finished: whether it went through.
 *   Only this yes or no is kept and reported, never what the step was or what it said; reading and asking are
 *   not steps here, so a hook script leaves `ok` out for them.
 * @property {'edit' | 'command' | 'test' | 'search' | 'commit' | 'other'} [step] with 'running', when a tool has
 *   finished (gone through or failed, but not stopped or refused by the listener): what kind of step it was
 *   (`stepOf` in classify.mjs). Counted, and the counts go with the next report; asking is no step, so left out.
 * @property {string} [cwd] the session's folder, where the agent says it: where git counts the lines of code
 *   when the listener has asked for them. Never sent or kept.
 * @property {{ tokens?: number, cost?: number }} [usage] with 'usage': the tokens a turn used and its cost in
 *   US dollars, as the agent counted them. Kept for the next report only while the listener has asked for them.
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
  const session = digest(step.id)
  const stateFile = path.join(HOME, 'sessions', `${session}.json`)
  const opens = step.kind === 'start' || step.kind === 'prompt'
  if (manner.known && !opens && step.kind !== 'end' && !existsSync(stateFile)) return null
  // what a turn used says nothing of a session not heard of otherwise
  if (step.kind === 'usage' && !existsSync(stateFile)) return null

  const config = loadConfig()
  const send = (body) => (manner.detach ? (postDetached(body), null) : post(config, body))
  const state = readJson(stateFile, { mode: null, agent: 'idle', tools: [], outcomes: [], sent: null })

  if (step.kind === 'end') {
    rmSync(stateFile, { force: true })
    rmSync(usageFile(session), { force: true })
    await send({ session, end: true, ts: started })
    return null
  }

  // what the listener has asked to have counted, as the relay last said; nothing until it says so
  const share = readShare()
  const folder = typeof step.cwd === 'string' && step.cwd ? step.cwd : process.cwd()

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
      if (STEP_KINDS.includes(step.step)) {
        const steps = state.steps ?? {}
        steps[step.step] = Math.min(STEPS, (steps[step.step] ?? 0) + 1)
        state.steps = steps
      }
      break
    case 'waiting':
      state.agent = 'waiting'
      break
    case 'stop':
      state.agent = 'idle'
      force = true
      break
    case 'usage':
      // kept for the next report like the outcomes, and only while asked for (below)
      if (share.usage) state.used = add(state.used, step.usage)
      break
    default:
      return null
  }

  // Lines of code, only while asked for: where the session starts from is taken at its first event
  // on which they are, and what it added is counted at the end of each turn. Switched off, the
  // starting point goes too, so nothing done meanwhile is counted when they are switched on again.
  if (!share.lines) delete state.lines
  else if (!state.lines) state.lines = baseline(folder)
  // Tokens and cost, only while asked for: switched off, what was kept for the next report goes, and
  // the status line's file is not read. The total last sent stays, so none of it is sent twice.
  if (!share.usage) delete state.used

  const sent = state.sent
  const due = force || !sent || sent.agent !== state.agent || sent.mode !== state.mode || started - sent.at > HEARTBEAT
  const outcomes = due ? (state.outcomes ?? []) : []
  const steps = due ? counted(state.steps) : null
  const lines = due && step.kind === 'stop' && share.lines ? growth(state.lines, folder) : null
  const usage = due && share.usage ? used(state, session) : null
  if (due) {
    state.sent = { agent: state.agent, mode: state.mode, at: started }
    state.outcomes = []
    state.steps = {}
    delete state.used
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
    ...(steps ? { steps } : {}),
    ...(lines ? { lines } : {}),
    ...(usage ? { usage } : {}),
    ...(computer ? { computer } : {}),
  })
  if (step.kind !== 'start') return null
  return greet(config, manner.detach ? null : reply !== null)
}

/** What the relay knows a session by: a digest of the agent's own id. Claude Code's status line names its file by the same. */
export const digest = (id) => createHash('sha256').update(String(id)).digest('base64url').slice(0, 16)

/** Where Claude Code's status line (statusline.mjs) keeps a session's cost so far, when it is set up. */
const usageFile = (session) => path.join(HOME, 'usage', `${session}.json`)

/** The step counts kept for a report, only the kinds there were any of; null when there were none. */
function counted(steps) {
  const kinds = Object.entries(steps ?? {}).filter(([kind, n]) => STEP_KINDS.includes(kind) && Number.isSafeInteger(n) && n > 0)
  return kinds.length ? Object.fromEntries(kinds) : null
}

const dollars = (value) => Math.round(value * 1e6) / 1e6

/** Usage kept for the next report, with what a turn used added. Only numbers: whole tokens, and dollars. */
function add(kept, usage) {
  const tokens = Number.isFinite(usage?.tokens) && usage.tokens > 0 ? Math.round(usage.tokens) : 0
  const cost = Number.isFinite(usage?.cost) && usage.cost > 0 ? usage.cost : 0
  return { tokens: Math.min(TOKENS, (kept?.tokens ?? 0) + tokens), cost: Math.min(COST, (kept?.cost ?? 0) + cost) }
}

/**
 * The tokens and cost a report carries: what the agent said its turns used since the last one
 * (OpenClaw), and what the session's cost has grown by since then, from the file Claude Code's status
 * line keeps (statusline.mjs). The cost there is the session's total so far, so the total last sent
 * is kept and only the growth goes; a total that goes down has started again from nothing (Claude
 * Code's /clear). The status line writes it only while tokens and cost are asked for, and it is read
 * only then; when they are switched on in the middle of a session, its first report after carries
 * the cost so far. Null when there is nothing to send.
 */
function used(state, session) {
  let usage = state.used ?? { tokens: 0, cost: 0 }
  const total = readJson(usageFile(session), null)?.cost
  if (Number.isFinite(total) && total >= 0) {
    const from = state.cost === undefined || total < state.cost ? 0 : state.cost
    usage = add(usage, { cost: total - from })
    state.cost = total
  }
  const cost = dollars(usage.cost)
  return usage.tokens > 0 || cost > 0 ? { tokens: usage.tokens, cost } : null
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
