#!/usr/bin/env node
// Copies the code every integration shares (shared/) into each of them.
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

/** Where the copies go, and which files each place needs. */
const TARGETS = {
  'plugin/scripts': RUNTIME,
  'integrations/codex/scripts': [...RUNTIME, ...SETUP],
  'integrations/cursor/scripts': [...RUNTIME, ...SETUP],
}

const banner = (name) => `// A copy of ${SHARED}/${name}, written by scripts/sync-integrations.mjs. Edit it there.\n`

/** The copy is the source with a line saying so, below the shebang if there is one. */
function copyOf(name) {
  const source = readFileSync(path.join(ROOT, SHARED, name), 'utf8')
  if (!source.startsWith('#!')) return banner(name) + source
  const end = source.indexOf('\n') + 1
  return source.slice(0, end) + banner(name) + source.slice(end)
}

const check = process.argv.includes('--check')
const stale = []

const used = new Set(Object.values(TARGETS).flat())
for (const name of readdirSync(path.join(ROOT, SHARED))) {
  if (!used.has(name)) stale.push(`${SHARED}/${name} is copied nowhere: add it to a target in scripts/sync-integrations.mjs`)
}

for (const [folder, names] of Object.entries(TARGETS)) {
  for (const name of names) {
    const file = path.join(ROOT, folder, name)
    const wanted = copyOf(name)
    let current = null
    try {
      current = readFileSync(file, 'utf8')
    } catch {
      // not there yet
    }
    if (current === wanted) continue
    if (check) stale.push(`${folder}/${name} differs from ${SHARED}/${name}`)
    else {
      writeFileSync(file, wanted)
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
