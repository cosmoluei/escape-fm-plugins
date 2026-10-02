#!/usr/bin/env node
// Adds escape.fm to Qwen Code: copies the hook scripts to ~/.escape-fm/qwen and adds the
// hooks to Qwen Code's settings.json, beside everything else in it.
//
//   node install.mjs                 install for every project (~/.qwen/settings.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the settings instead of writing them
//   node install.mjs --dir <folder>  the folder that holds settings.json, if not ~/.qwen

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'qwen',
  agent: 'Qwen Code',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? path.join(homedir(), '.qwen'),
  file: 'settings.json',
  blank: { hooks: {} },
  after: ['Qwen Code reads its settings when it starts: start it again. The hooks are listed by /hooks.'],
})
