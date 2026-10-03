#!/usr/bin/env node
// Adds escape.fm to WorkBuddy: copies the hook scripts to ~/.escape-fm/workbuddy and adds the
// hooks to WorkBuddy's settings.json, beside everything else in it.
//
//   node install.mjs                 install for every task (~/.workbuddy/settings.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the settings instead of writing them
//   node install.mjs --dir <folder>  the folder that holds settings.json, if not $WORKBUDDY_CONFIG_DIR or ~/.workbuddy

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'workbuddy',
  agent: 'WorkBuddy',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? (process.env.WORKBUDDY_CONFIG_DIR?.trim() || path.join(homedir(), '.workbuddy')),
  file: 'settings.json',
  blank: { hooks: {} },
  after: ['WorkBuddy reads its hooks only when it starts: quit it completely and open it again.'],
})
