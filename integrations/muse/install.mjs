#!/usr/bin/env node
// Adds escape.fm to Muse Code: copies the hook scripts to ~/.escape-fm/muse and adds the hooks
// to Muse Code's user settings, beside everything else in them, so they run in every project
// without a .muse/hooks.json in each.
//
//   node install.mjs                 install for every project (~/.config/muse/settings.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the settings instead of writing them
//   node install.mjs --dir <folder>  the folder that holds settings.json, if not $XDG_CONFIG_HOME/muse or ~/.config/muse

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

const config = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), '.config')

setup({
  tool: 'muse',
  agent: 'Muse Code',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? path.join(config, 'muse'),
  file: 'settings.json',
  // Muse Code refuses a settings file without its schema version
  blank: { schema_version: 1, hooks: {} },
  after: ['Muse Code reads its hooks when a session starts: start a new one.'],
})
