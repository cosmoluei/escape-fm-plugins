// A copy of shared/lib.mjs, written by scripts/sync-integrations.mjs. Edit it there.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Not in shared/: each integration's copy is written from its manifest by scripts/sync-integrations.mjs.
import { CLIENT, VERSION } from './client.mjs'

export const API = (process.env.ESCAPE_FM_API ?? 'https://api.escape.fm').replace(/\/$/, '')
export const PLAYER = (process.env.ESCAPE_FM_PLAYER ?? 'https://escape.fm').replace(/\/$/, '')
/** Shared by every escape.fm integration on this machine, so they all reach the same player. */
export const HOME = process.env.ESCAPE_FM_HOME ?? path.join(homedir(), '.escape-fm')
const CONFIG = path.join(HOME, 'config.json')
/** What the listener asked this machine's plugins to count beside the tags; the relay says so in every answer. */
const SHARE = path.join(HOME, 'share.json')
/**
 * Every report says openly which integration sent it and which version, so the relay can
 * count them apart (docs/analytics.md). Nothing about the machine or the listener is in it;
 * the one thing about the machine a report carries is its name, in the body (computer.mjs).
 */
export const USER_AGENT = `escape-fm/${VERSION} (${CLIENT})`

export function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Written whole or not at all: hooks run as parallel processes, and one must never read half of what another is writing. */
export function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, JSON.stringify(data) + '\n', { mode: 0o600 })
  renameSync(draft, file)
}

/**
 * The listener key pairs this machine with a player. It is made here on first use
 * and only ever handed to the player through a URL fragment.
 *
 * `firstRun` stays true until the listener has been shown the player (see `welcomed`),
 * and not only in the process that made the key: an integration switched on in the
 * middle of a session makes the key on some other event than a session's start.
 */
export function loadConfig() {
  const existing = readJson(CONFIG, null)
  if (existing?.key) return { ...existing, firstRun: existing.unopened === true }
  const config = { key: randomBytes(24).toString('base64url'), unopened: true }
  writeJson(CONFIG, config)
  return { ...config, firstRun: true }
}

/** The listener has been shown the player, or told how to open it. Once is enough. */
export function welcomed() {
  const { unopened, ...config } = readJson(CONFIG, {})
  if (unopened !== undefined && config.key) writeJson(CONFIG, config)
}

export const pairingUrl = (config) => `${PLAYER}/#k=${config.key}`

/** A machine with no screen to open a browser on. */
export function headless() {
  if (process.env.CLAUDE_CODE_REMOTE === 'true' || process.env.CURSOR_CODE_REMOTE === 'true' || process.env.SSH_CONNECTION) return true
  return platform() === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
}

export function openBrowser(url) {
  const [command, args] =
    platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]]
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
    return true
  } catch {
    return false
  }
}

/**
 * Which of the counts that are only sent when asked for the listener has switched on, on their page
 * in escape.fm ("Lines of code", "Tokens and cost"): as the relay last said. Off until it says so.
 * @returns {{ lines: boolean, usage: boolean }}
 */
export function readShare() {
  const share = readJson(SHARE, null)
  return { lines: share?.lines === true, usage: share?.usage === true }
}

/**
 * Keeps what the relay's answer says was asked for (docs/integrations.md, "Asked for"). An answer
 * from a key no account has claimed has no `share`, and nothing is asked for then. A request that
 * failed, or anything that is not the relay's answer, changes nothing. Written only when it changed.
 */
function noteShare(reply) {
  if (!reply || typeof reply !== 'object' || typeof reply.listeners !== 'number') return
  const asked = reply.share && typeof reply.share === 'object' ? reply.share : {}
  const share = { lines: asked.lines === true, usage: asked.usage === true }
  const kept = readJson(SHARE, null)
  if (kept?.lines === share.lines && kept?.usage === share.usage) return
  try {
    writeJson(SHARE, { ...share, at: Date.now() })
  } catch {
    // the next answer tries again
  }
}

const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * POST the tags. curl goes first because it honours proxy settings from the
 * environment, which Node's fetch does not; the request is passed on stdin so the
 * key never shows up in the process list.
 * @returns {Promise<object | null>} the relay's answer, or null if it could not be reached. What the
 *   answer says the listener asked to have counted is kept in share.json (`readShare`).
 */
export function post(config, body, timeout = 4) {
  const url = `${API}/v1/signal`
  const payload = JSON.stringify(body)
  return new Promise((resolve) => {
    const curl = execFile('curl', ['--config', '-'], { timeout: (timeout + 1) * 1000 }, async (error, stdout) => {
      if (!error) return resolve(answered(readParsed(stdout)))
      if (error.code !== 'ENOENT') return resolve(null)
      // no curl on this machine
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}`, 'user-agent': USER_AGENT },
          body: payload,
          signal: AbortSignal.timeout(timeout * 1000),
        })
        const reply = await res.json()
        resolve(res.ok ? answered(reply) : reply)
      } catch {
        resolve(null)
      }
    })
    curl.stdin?.on('error', () => {})
    curl.stdin?.end(
      [
        `url = ${quote(url)}`,
        'request = "POST"',
        'header = "content-type: application/json"',
        `user-agent = ${quote(USER_AGENT)}`,
        `header = ${quote(`authorization: Bearer ${config.key}`)}`,
        `data = ${quote(payload)}`,
        `max-time = ${timeout}`,
        'silent',
        'fail',
        '',
      ].join('\n'),
    )
  })
}

/**
 * For a hook its agent waits on: the request goes to a process of its own (send.mjs)
 * and this one returns at once. The relay orders reports by `ts`, so one that arrives
 * late cannot undo a newer one. The key is not passed along; send.mjs reads it itself.
 */
export function postDetached(body) {
  try {
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'send.mjs')
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'ignore', 'ignore'], detached: true, windowsHide: true })
    child.on('error', () => {})
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(body))
    child.unref()
  } catch {
    // nothing to be done about it, and nobody to tell
  }
}

/** The relay's answer, once what it says was asked for is kept. */
function answered(reply) {
  noteShare(reply)
  return reply
}

function readParsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
