#!/usr/bin/env node
// Adds escape.fm to CodeBuddy Code: copies the hook scripts to ~/.escape-fm/codebuddy and adds
// the hooks to CodeBuddy's settings.json, beside everything else in it.
//
//   node install.mjs                 install for every project (~/.codebuddy/settings.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the settings instead of writing them
//   node install.mjs --dir <folder>  the folder that holds settings.json, if not $CODEBUDDY_CONFIG_DIR or ~/.codebuddy

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'codebuddy',
  agent: 'CodeBuddy Code',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? (process.env.CODEBUDDY_CONFIG_DIR?.trim() || path.join(homedir(), '.codebuddy')),
  file: 'settings.json',
  blank: { hooks: {} },
  after: ['CodeBuddy reads its hooks when it starts: start it again. They are listed by /hooks.'],
})
