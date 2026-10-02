#!/usr/bin/env node
// Adds escape.fm to Factory Droid without its plugin system: copies the hook scripts to
// ~/.escape-fm/droid and adds the hooks to Droid's hooks.json. Droid reads the `hooks` in its
// settings.json only while there is no hooks.json, so where the hooks are kept there, they
// are added there.
//
//   node install.mjs                 install for every project (~/.factory), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the hooks instead of writing them
//   node install.mjs --dir <folder>  Droid's folder, if not ~/.factory

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

const dir = option('--dir') ?? path.join(homedir(), '.factory')

/** The listener's hooks are in settings.json, and there is no hooks.json to shadow them. */
function inSettings() {
  if (existsSync(path.join(dir, 'hooks.json'))) return false
  try {
    const settings = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))
    return settings !== null && typeof settings.hooks === 'object'
  } catch {
    return false
  }
}

const settings = inSettings()
setup({
  tool: 'droid',
  agent: 'Droid',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir,
  ...(settings ? { file: 'settings.json', blank: { hooks: {} } } : { file: 'hooks.json', wrapped: false, blank: {} }),
  after: ['Droid reads its hooks when it starts: start it again. They are listed by /hooks.'],
})
