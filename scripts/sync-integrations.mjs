#!/usr/bin/env node
// Copies the code every integration shares (shared/) into each of them, and writes
// each one's client.mjs: which integration it is and its version, from its manifest.
// An integration that is another's under a name of its own (WorkBuddy, CodeBuddy's) also
// gets that one's hook script and hooks.
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
const RUNTIME = ['classify.mjs', 'lib.mjs', 'computer.mjs', 'session.mjs', 'send.mjs', 'open.mjs']
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
  'integrations/qwen/scripts': { files: [...RUNTIME, ...SETUP], client: 'qwen-code', manifest: 'integrations/qwen/qwen-extension.json' },
  'integrations/gemini/scripts': { files: [...RUNTIME, ...SETUP], client: 'gemini-cli', manifest: 'integrations/gemini/gemini-extension.json' },
  'integrations/copilot/scripts': { files: [...RUNTIME, ...SETUP], client: 'copilot-cli', manifest: 'integrations/copilot/plugin.json' },
  'integrations/droid/scripts': { files: [...RUNTIME, ...SETUP], client: 'droid', manifest: 'integrations/droid/.factory-plugin/plugin.json' },
  'integrations/codebuddy/scripts': { files: [...RUNTIME, ...SETUP], client: 'codebuddy', manifest: 'integrations/codebuddy/.codebuddy-plugin/plugin.json' },
  'integrations/workbuddy/scripts': { files: [...RUNTIME, ...SETUP], client: 'workbuddy', manifest: 'integrations/workbuddy/.workbuddy-plugin/plugin.json' },
  'integrations/openclaw/scripts': { files: RUNTIME, client: 'openclaw', manifest: 'integrations/openclaw/openclaw.plugin.json' },
  'integrations/muse/scripts': { files: [...RUNTIME, ...SETUP], client: 'muse-code', manifest: 'integrations/muse/manifest.json' },
}

/**
 * Integrations that are another's under a name of their own: WorkBuddy runs CodeBuddy Code inside it,
 * with the same events and tools, so its hook script and hooks are CodeBuddy's, copied as they are.
 */
const SIBLINGS = {
  'integrations/workbuddy': { from: 'integrations/codebuddy', files: ['scripts/hook.mjs', 'hooks/hooks.json'] },
}

const banner = (from) => `// A copy of ${from}, written by scripts/sync-integrations.mjs. Edit it there.\n`

/** The copy is the source with a line saying so, below the shebang if there is one; JSON, which has no comments, as it is. */
function copyOf(from) {
  const source = readFileSync(path.join(ROOT, from), 'utf8')
  if (from.endsWith('.json')) return source
  if (!source.startsWith('#!')) return banner(from) + source
  const end = source.indexOf('\n') + 1
  return source.slice(0, end) + banner(from) + source.slice(end)
}

/** Not a copy: the one file that differs between the integrations, made from the target's manifest. */
function clientOf({ client, manifest }) {
  const { version } = JSON.parse(readFileSync(path.join(ROOT, manifest), 'utf8'))
  return [
    `// Written by scripts/sync-integrations.mjs from ${manifest}. Change the version there.`,
    '// lib.mjs sends these two as the User-Agent of every report; the only other thing about this machine sent is its name (computer.mjs).',
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

/** Writes one file, or with --check notes that it is out of date. */
function want(file, text, source) {
  let current = null
  try {
    current = readFileSync(path.join(ROOT, file), 'utf8')
  } catch {
    // not there yet
  }
  if (current === text) return
  if (check) stale.push(`${file} differs from ${source}`)
  else {
    writeFileSync(path.join(ROOT, file), text)
    console.log(`wrote ${file}`)
  }
}

for (const [folder, target] of Object.entries(TARGETS)) {
  for (const name of target.files) want(`${folder}/${name}`, copyOf(`${SHARED}/${name}`), `${SHARED}/${name}`)
  want(`${folder}/client.mjs`, clientOf(target), target.manifest)
}
for (const [folder, sibling] of Object.entries(SIBLINGS)) {
  for (const name of sibling.files) want(`${folder}/${name}`, copyOf(`${sibling.from}/${name}`), `${sibling.from}/${name}`)
}

if (stale.length) {
  console.error(stale.join('\n'))
  console.error('Run `node scripts/sync-integrations.mjs` and commit the result.')
  process.exit(1)
}
if (check) console.log('The copies of shared/ are in sync.')
