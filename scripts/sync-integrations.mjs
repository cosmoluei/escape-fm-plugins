#!/usr/bin/env node
// Copies the code every integration shares (shared/) into each of them, and writes
// each one's client.mjs: which integration it is and its version, from its manifest.
//
//   node scripts/sync-integrations.mjs            write the copies
//   node scripts/sync-integrations.mjs --check    change nothing; exit 1 if a copy is out of date
//
// Why copies and not imports: an agent installs an integration by copying its folder
// somewhere else (a plugin cache, ~/.escape-fm), so a script there cannot reach back
// into this repository. Each folder has to hold everything it runs. The copies are
// committed, because the folders are installed straight from git with no build step.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHARED = 'shared'
/** What a hook script runs on. */
const RUNTIME = ['classify.mjs', 'lib.mjs', 'session.mjs', 'send.mjs', 'open.mjs']
/** What install.mjs runs on, for the agents that can be set up by hand. */
const SETUP = ['setup.mjs']

/**
 * Where the copies go, which files each place needs, and who it is: the name it gives the
 * relay in its User-Agent, and the manifest its version is read from.
 */
const TARGETS = {
  'plugin/scripts': { files: RUNTIME, client: 'claude-code', manifest: 'plugin/.claude-plugin/plugin.json' },
  'integrations/codex/scripts': { files: [...RUNTIME, ...SETUP], client: 'codex', manifest: 'integrations/codex/.codex-plugin/plugin.json' },
  'integrations/cursor/scripts': { files: [...RUNTIME, ...SETUP], client: 'cursor', manifest: 'integrations/cursor/.cursor-plugin/plugin.json' },
}

const banner = (name) => `// A copy of ${SHARED}/${name}, written by scripts/sync-integrations.mjs. Edit it there.\n`

/** The copy is the source with a line saying so, below the shebang if there is one. */
function copyOf(name) {
  const source = readFileSync(path.join(ROOT, SHARED, name), 'utf8')
  if (!source.startsWith('#!')) return banner(name) + source
  const end = source.indexOf('\n') + 1
  return source.slice(0, end) + banner(name) + source.slice(end)
}

/** Not a copy: the one file that differs between the integrations, made from the target's manifest. */
function clientOf({ client, manifest }) {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, manifest), 'utf8'))
  return [
    `// Written by scripts/sync-integrations.mjs from ${manifest}. Change the version there.`,
    '// lib.mjs sends these two as the User-Agent of every report, and nothing else about this machine.',
    `export const CLIENT = '${client}'`,
    `export const VERSION = '${version}'`,
    '',
  ].join('\n')
}

const check = process.argv.includes('--check')
const stale = []

const used = new Set(Object.values(TARGETS).flatMap((target) => target.files))
for (const name of readdirSync(path.join(ROOT, SHARED))) {
  if (!used.has(name)) stale.push(`${SHARED}/${name} is copied nowhere: add it to a target in scripts/sync-integrations.mjs`)
}

for (const [folder, target] of Object.entries(TARGETS)) {
  const wanted = new Map(target.files.map((name) => [name, copyOf(name)]))
  wanted.set('client.mjs', clientOf(target))
  for (const [name, text] of wanted) {
    const file = path.join(ROOT, folder, name)
    let current = null
    try {
      current = readFileSync(file, 'utf8')
    } catch {
      // not there yet
    }
    if (current === text) continue
    if (check) stale.push(`${folder}/${name} differs from ${name === 'client.mjs' ? target.manifest : `${SHARED}/${name}`}`)
    else {
      writeFileSync(file, text)
      console.log(`wrote ${folder}/${name}`)
    }
  }
}

if (stale.length) {
  console.error(stale.join('\n'))
  console.error('Run `node scripts/sync-integrations.mjs` and commit the result.')
  process.exit(1)
}
if (check) console.log('The copies of shared/ are in sync.')
