#!/usr/bin/env node
// Claude Code's status line, for a listener who has asked escape.fm to count the tokens and cost of
// their agents' work. Claude Code's hooks are not told what a session costs; its status line is
// (https://code.claude.com/docs/en/statusline), and a plugin cannot set one up, so the listener does:
//
//   node statusline.mjs --install   copies this file to ~/.escape-fm/statusline.mjs and prints the
//                                   `statusLine` setting to add to ~/.claude/settings.json
//
// Claude Code then runs it after each of its answers, with the session's state on stdin. Of that,
// three things are read: the session's id, its cost so far in US dollars (`cost.total_cost_usd`,
// Claude Code's own estimate) and the model's name, which is all the line shows. While the
// listener's page says tokens and cost are counted (~/.escape-fm/share.json, which the plugin keeps),
// the cost is written to ~/.escape-fm/usage/<session>.json, under the digest the plugin knows the
// session by; the plugin sends how much it grew with its next report (session.mjs). Nothing here
// sends anything. The tokens Claude Code shows a status line are only its last answer's, so only the
// cost is counted.
//
// It is copied out of the plugin and runs on its own, so it imports nothing of the plugin's.

import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HOME = process.env.ESCAPE_FM_HOME ?? path.join(homedir(), '.escape-fm')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/** Written whole or not at all, as the plugin's own files are: the plugin may be reading it. */
function writeJson(file, data) {
  mkdirSync(path.dirname(file), { recursive: true })
  const draft = `${file}.${process.pid}.tmp`
  writeFileSync(draft, JSON.stringify(data) + '\n', { mode: 0o600 })
  renameSync(draft, file)
}

function install() {
  const target = path.join(HOME, 'statusline.mjs')
  mkdirSync(HOME, { recursive: true })
  copyFileSync(fileURLToPath(import.meta.url), target)
  const setting = { statusLine: { type: 'command', command: `node "${target}"` } }
  console.log(`Copied to ${target}. Add this to ~/.claude/settings.json (it replaces any status line set there):\n`)
  console.log(JSON.stringify(setting, null, 2))
}

function line(input) {
  const model = typeof input?.model?.display_name === 'string' ? input.model.display_name.slice(0, 40) : 'Claude'
  const id = input?.session_id
  const cost = input?.cost?.total_cost_usd
  const counted = !process.env.ESCAPE_FM_DISABLE && readJson(path.join(HOME, 'share.json'))?.usage === true
  if (!counted || typeof id !== 'string' || !id || !Number.isFinite(cost) || cost < 0) return model
  const session = createHash('sha256').update(id).digest('base64url').slice(0, 16)
  const file = path.join(HOME, 'usage', `${session}.json`)
  // the session's total so far: written when it changed, and the plugin sends what it grew by
  if (readJson(file)?.cost !== cost) {
    try {
      writeJson(file, { cost, at: Date.now() })
    } catch {
      // the next answer writes it
    }
  }
  return `${model} · $${cost.toFixed(2)}`
}

if (process.argv.includes('--install')) install()
else {
  let input = null
  try {
    input = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    // nothing to show but a name
  }
  try {
    process.stdout.write(line(input) + '\n')
  } catch {
    // a status line never gets in the way
  }
}
