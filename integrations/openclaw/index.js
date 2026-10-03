// escape.fm for OpenClaw: a plugin that runs inside the OpenClaw gateway and tells the escape.fm
// player what the agent is doing in each conversation. See README.md.
//
// OpenClaw has no hooks that run a command; a plugin subscribes to its events in-process. This file
// only listens: it returns nothing to any hook, so it cannot allow, block or change anything, and it
// reads no message, prompt, reply, tool input or result. Of each event it keeps the conversation's key
// (to tell conversations apart; scripts/hook.mjs sends only a digest of it), the run's id, a tool's
// name, whether a tool failed, whether an approval is pending, and a turn's tokens and cost, and hands
// that to scripts/hook.mjs, one event at a time, in a process of its own, as every other
// integration's agent does. The tokens and cost go further only if the listener has asked for them.

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'scripts', 'hook.mjs')
/** Events waiting for the one before them to be handed over; past this, new ones are dropped. */
const BACKLOG = 64

/**
 * Hands one event to scripts/hook.mjs on its own process, in order: each waits for the last, so the
 * session's state file is written in the order things happened. The gateway never waits for it.
 */
function forwarder() {
  let queue = Promise.resolve()
  let waiting = 0
  return (event) => {
    if (waiting >= BACKLOG) return
    waiting += 1
    queue = queue.then(
      () =>
        new Promise((resolve) => {
          const done = () => {
            waiting -= 1
            resolve()
          }
          try {
            const child = spawn(process.execPath, [HOOK], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
            child.on('error', done).on('close', done)
            child.stdin.on('error', () => {})
            child.stdin.end(JSON.stringify(event))
          } catch {
            done()
          }
        }),
    )
  }
}

/** A conversation in a group or a channel, where others than the owner write: their messages are not the owner typing. */
const shared = (key) => /:(group|channel):/.test(key)

const text = (value) => (typeof value === 'string' && value ? value : undefined)

/**
 * Subscribes to OpenClaw's events. `send` is given objects in the shape scripts/hook.mjs reads:
 * `session_id` (the conversation's key), `hook_event_name`, for a tool its name and whether it failed,
 * and for a turn's `usage` its `tokens` and `cost`.
 * Every handler returns nothing and never throws, so it changes nothing and holds nothing up.
 */
export function listen(api, send = forwarder()) {
  /** runs by id: which conversation each belongs to, learnt when it starts */
  const runs = new Map()
  /** approvals pending in each conversation, by id */
  const approvals = new Map()

  const safely =
    (handler) =>
    (...args) => {
      try {
        handler(...args)
      } catch {
        // a music plugin never gets in the way of the work
      }
    }
  const keyOf = (event, ctx) => text(event?.sessionKey) ?? text(ctx?.sessionKey) ?? runs.get(event?.runId ?? ctx?.runId)
  const emit = (key, hook_event_name, more = {}) => key && send({ session_id: key, hook_event_name, ...more })

  /** An approval asked for or answered: waiting while any in the conversation is pending. */
  function approval(key, id, pending) {
    if (!key) return
    const open = approvals.get(key) ?? new Set()
    const was = open.size > 0
    if (pending) open.add(id ?? 'one')
    else open.delete(id ?? 'one')
    approvals.set(key, open)
    if (open.size > 0 && !was) emit(key, 'approval_requested')
    if (open.size === 0 && was) emit(key, 'approval_resolved')
  }

  // the owner's message arriving; not read, in a group not the owner's
  api.on(
    'message_received',
    safely((event, ctx) => {
      const key = keyOf(event, ctx)
      if (key && !shared(key)) emit(key, 'message_received')
    }),
  )

  // a tool starting and finishing, by name; of the result only whether it is an error
  api.on(
    'before_tool_call',
    safely((event, ctx) => {
      const key = keyOf(event, ctx)
      const run = event?.runId ?? ctx?.runId
      if (key && run) runs.set(run, key)
      emit(key, 'tool_start', { tool_name: text(event?.toolName) ?? text(ctx?.toolName) })
    }),
  )
  api.on(
    'after_tool_call',
    safely((event, ctx) => {
      const key = keyOf(event, ctx)
      // OpenClaw 2026.3: a command that needs the owner's approval returns at once, saying so
      if (event?.result?.details?.status === 'approval-pending') return approval(key, text(event.result.details.approvalId), true)
      emit(key, 'tool_end', { tool_name: text(event?.toolName) ?? text(ctx?.toolName), failed: event?.error !== undefined && event?.error !== null })
    }),
  )

  // A reply going out carries what its turn used (`usageState`), beside the reply itself (`payload`),
  // which is not read. Only two numbers are taken: the tokens the turn's calls to the model used
  // (`usage.total`) and its cost in US dollars (`turnUsd`, only when OpenClaw has a cost table). A turn
  // sends several payloads with the same totals, so a turn is counted once, at its final one.
  /** runs whose usage has been passed on, the latest few */
  const counted = []
  api.on(
    'reply_payload_sending',
    safely((event, ctx) => {
      if (event?.kind !== 'final') return
      const state = event?.usageState
      if (!state || typeof state !== 'object') return
      const run = text(event?.runId)
      if (run) {
        if (counted.includes(run)) return
        counted.push(run)
        if (counted.length > 32) counted.shift()
      }
      const tokens = state.usage?.total
      const cost = state.turnUsd
      const usage = {
        ...(Number.isFinite(tokens) && tokens > 0 ? { tokens } : {}),
        ...(Number.isFinite(cost) && cost > 0 ? { cost } : {}),
      }
      if (Object.keys(usage).length) emit(keyOf(event, ctx), 'usage', usage)
    }),
  )

  api.on(
    'session_end',
    safely((event, ctx) => {
      const key = keyOf(event, ctx)
      approvals.delete(key)
      emit(key, 'session_end')
    }),
  )

  // the first time on this machine, the player opens, paired with it
  api.on(
    'gateway_start',
    safely(() => send({ hook_event_name: 'gateway_start' })),
  )

  // runs starting and ending, approvals and questions: OpenClaw's own event stream, of which only
  // the stream's name, the phase or state and the ids are read
  api.runtime?.events?.onAgentEvent?.(
    safely((event) => {
      if (event?.isHeartbeat === true) return
      const data = event?.data ?? {}
      const key = text(event?.sessionKey) ?? runs.get(event?.runId)
      if (event?.stream === 'lifecycle') {
        if (data.phase === 'start') {
          if (key) runs.set(event.runId, key)
          return emit(key, 'run_start')
        }
        if (data.phase === 'waiting-approval') return approval(key, text(data.approvalId), true)
        if (data.phase === 'approval-resolved') return approval(key, text(data.approvalId), false)
        if (data.phase === 'end' || data.phase === 'error') {
          runs.delete(event.runId)
          // OpenClaw 2026.3 ends the run while its approval waits; the next run picks up after it
          if ((approvals.get(key)?.size ?? 0) > 0) return
          return emit(key, 'run_end')
        }
        return
      }
      if (event?.stream === 'execution' && data.approval && typeof data.approval === 'object') {
        return approval(key, text(data.approval.id), data.approval.state === 'pending')
      }
      if (event?.stream === 'approval' && (data.phase === 'requested' || data.phase === 'resolved')) {
        return approval(key, text(data.approvalId) ?? text(data.itemId), data.phase === 'requested')
      }
      if (event?.stream === 'execution' && data.state === 'waiting' && data.wait?.kind === 'user_input') return emit(key, 'question')
    }),
  )
}

export default {
  id: 'escape-fm',
  name: 'escape.fm',
  description: 'Background music that follows your work: tells the escape.fm player what the agent is doing, never what it says.',
  register(api) {
    listen(api)
  },
}
