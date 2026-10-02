#!/usr/bin/env node
// Adds escape.fm to Gemini CLI's settings instead of as an extension: copies the hook scripts
// to ~/.escape-fm/gemini and adds the hooks to Gemini CLI's settings.json, beside everything
// else in it. The extension (README.md) is the simpler way; this is for those who keep their
// hooks in their settings.
//
//   node install.mjs                 install for every project (~/.gemini/settings.json), or update
//   node install.mjs --uninstall     take it out again
//   node install.mjs --print         copy the scripts, and print the settings instead of writing them
//   node install.mjs --dir <folder>  the folder that holds settings.json, if not ~/.gemini

import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { option, setup } from './scripts/setup.mjs'

setup({
  tool: 'gemini',
  agent: 'Gemini CLI',
  root: path.dirname(fileURLToPath(import.meta.url)),
  dir: option('--dir') ?? path.join(homedir(), '.gemini'),
  file: 'settings.json',
  blank: { hooks: {} },
  after: ['Gemini CLI reads its settings when it starts: start it again. The hooks are listed by /hooks panel.'],
})
