#!/usr/bin/env node
// Adds escape.fm to Codex without its plugin system: copies the hook scripts to
// ~/.escape-fm/codex and adds the hooks to Codex's hooks.json.
//
//   node install.mjs                 install, or update what is installed
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the hooks instead of writing them
//   node install.mjs --dir <folder>  Codex's folder, if not $CODEX_HOME or ~/.codex

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'codex',
  agent: 'Codex',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? process.env.CODEX_HOME ?? path.join(homedir(), '.codex'),
  blank: { hooks: {} },
  after: ['Codex runs a hook only once you have approved it: start Codex, run /hooks, and trust the escape.fm entries.'],
})
