#!/usr/bin/env node
// Adds escape.fm to Cursor: copies the hook scripts to ~/.escape-fm/cursor and adds
// the hooks to Cursor's hooks.json. Cursor reads that file again by itself.
//
//   node install.mjs                 install for every project (~/.cursor/hooks.json), or update
//   node install.mjs --project       install for the project you are in (.cursor/hooks.json)
//   node install.mjs --uninstall     take it out again (with --project or --dir if installed that way)
//   node install.mjs --print         copy the scripts, and print the hooks instead of writing them
//   node install.mjs --dir <folder>  the folder that holds hooks.json, if neither of the above

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

const project = process.argv.includes('--project')

setup({
  tool: 'cursor',
  agent: 'Cursor',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? (project ? path.join(process.cwd(), '.cursor') : path.join(homedir(), '.cursor')),
  create: project,
  blank: { version: 1, hooks: {} },
  after: ['Cursor picks the hooks up by itself; they are listed under Customize, in the Hooks tab.'],
})
