#!/usr/bin/env node
// Adds escape.fm to GitHub Copilot CLI: copies the hook scripts to ~/.escape-fm/copilot and
// writes a hook file of its own, escape-fm.json, into Copilot CLI's folder of user hooks.
//
//   node install.mjs                 install for every project (~/.copilot/hooks/escape-fm.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the hook file instead of writing it
//   node install.mjs --dir <folder>  the folder of hook files, if not $COPILOT_HOME/hooks or ~/.copilot/hooks

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'copilot',
  agent: 'Copilot CLI',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? path.join(process.env.COPILOT_HOME ?? path.join(homedir(), '.copilot'), 'hooks'),
  file: 'escape-fm.json',
  own: true,
  create: true,
  blank: { version: 1, hooks: {} },
  after: ['Copilot CLI reads its hooks when a session starts: start a new one.'],
})
