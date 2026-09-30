// A copy of shared/lib.mjs, written by scripts/sync-integrations.mjs. Edit it there.
import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const API = (process.env.ESCAPE_FM_API ?? 'https://api.escape.fm').replace(/\/$/, '')
export const PLAYER = (process.env.ESCAPE_FM_PLAYER ?? 'https://escape.fm').replace(/\/$/, '')
/** Shared by every escape.fm integration on this machine, so they all reach the same player. */
export const HOME = process.env.ESCAPE_FM_HOME ?? path.join(homedir(), '.escape-fm')
const CONFIG = path.join(HOME, 'config.json')

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

const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/**
 * POST the tags. curl goes first because it honours proxy settings from the
 * environment, which Node's fetch does not; the request is passed on stdin so the
 * key never shows up in the process list.
 * @returns {Promise<object | null>} the relay's answer, or null if it could not be reached
 */
export function post(config, body, timeout = 4) {
  const url = `${API}/v1/signal`
  const payload = JSON.stringify(body)
  return new Promise((resolve) => {
    const curl = execFile('curl', ['--config', '-'], { timeout: (timeout + 1) * 1000 }, async (error, stdout) => {
      if (!error) return resolve(readParsed(stdout))
      if (error.code !== 'ENOENT') return resolve(null)
      // no curl on this machine
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
          body: payload,
          signal: AbortSignal.timeout(timeout * 1000),
        })
        resolve(await res.json())
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

function readParsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
