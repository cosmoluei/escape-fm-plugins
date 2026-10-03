// A copy of shared/computer.mjs, written by scripts/sync-integrations.mjs. Edit it there.
// This computer's name as its owner sees it, so the listener's page can list the machine
// by name rather than as "Device 2". It is the one thing about the machine a report carries,
// and only the name its owner gave it: macOS's Computer Name, or the host name made readable.
// ESCAPE_FM_COMPUTER_NAME replaces it, and set to nothing sends none.
//
// Hooks run often, so it is worked out once a day and kept in ~/.escape-fm/computer.json:
// a file of its own, because config.json is rewritten by whichever hook gets there first.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { hostname, platform } from 'node:os'
import path from 'node:path'
import { HOME, readJson, writeJson } from './lib.mjs'

const CACHE = path.join(HOME, 'computer.json')
const DAY = 24 * 60 * 60 * 1000
/** Code points, as the relay counts them. */
const MAX = 40

/** Trimmed, one space between words, no control or invisible characters, at most MAX long; null if nothing is left. */
export function clean(value) {
  if (typeof value !== 'string') return null
  const text = value
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const capped = [...text].slice(0, MAX).join('').trim()
  return capped || null
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const UUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i

/** A word as a person would write it: `ada` and `ADA` become `Ada`; `PC`, and anything mixed, `AB12CD` or `MacBook`, stay. */
function word(part) {
  if (/^[a-z]+$/.test(part)) return part[0].toUpperCase() + part.slice(1)
  if (/^[A-Z]{3,}$/.test(part)) return part[0] + part.slice(1).toLowerCase()
  return part
}

/**
 * A host name made into something a person would call the machine: `ada-thinkpad.local` is
 * `Ada Thinkpad`, `DESKTOP-AB12CD` is `Desktop AB12CD`. Null for a name that says nothing:
 * `localhost`, an address (`10.0.0.5`, `ip-172-31-5-10`), or a container's or cloud machine's id.
 * @param {unknown} name
 * @returns {string | null}
 */
export function prettify(name) {
  if (typeof name !== 'string') return null
  let host = name.trim()
  if (!host || IPV4.test(host) || host.includes(':')) return null
  // the domain it is in, `.local` or `.lan` most often, says nothing about the machine
  host = host.split('.')[0]
  const lower = host.toLowerCase()
  if (!lower || lower === 'localhost' || /^ip-\d+-\d+-\d+-\d+$/.test(lower)) return null
  const compact = lower.replace(/[-_]/g, '')
  if (UUID.test(host) || (/^[0-9a-f]{12,}$/.test(compact) && /\d/.test(compact))) return null
  if (!/\p{L}/u.test(host)) return null
  return clean(host.split(/[-_\s]+/).filter(Boolean).map(word).join(' '))
}

/** Asks the system, every time; computerName() is what keeps it. */
function detect() {
  const os = platform()
  if (os === 'darwin') {
    try {
      // the name in System Settings → General → Sharing, as the owner typed it
      const named = clean(execFileSync('/usr/sbin/scutil', ['--get', 'ComputerName'], { encoding: 'utf8', timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'] }))
      if (named) return named
    } catch {
      // no scutil, or it took too long: the host name will do
    }
  } else if (os === 'linux') {
    try {
      // what hostnamectl calls the pretty host name, when someone has set one
      const line = readFileSync('/etc/machine-info', 'utf8').match(/^\s*PRETTY_HOSTNAME=(.*)$/m)?.[1] ?? ''
      const value = line.trim().replace(/^(["'])(.*)\1$/, '$2').replace(/\\(.)/g, '$1')
      const named = clean(value)
      if (named) return named
    } catch {
      // not there, as on most machines
    }
  }
  return prettify(hostname())
}

/**
 * The name to send with a report, or null for none.
 * @returns {string | null}
 */
export function computerName() {
  const given = process.env.ESCAPE_FM_COMPUTER_NAME
  if (given !== undefined) return clean(given)
  const now = Date.now()
  const kept = readJson(CACHE, null)
  if (kept && typeof kept.at === 'number' && kept.at <= now && now - kept.at < DAY && (kept.name === null || typeof kept.name === 'string')) {
    return clean(kept.name)
  }
  let name = null
  try {
    name = detect()
  } catch {
    // a report goes out without it
  }
  try {
    writeJson(CACHE, { name, at: now })
  } catch {
    // asked again next time
  }
  return name
}
