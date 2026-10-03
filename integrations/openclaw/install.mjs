#!/usr/bin/env node
// Adds escape.fm to OpenClaw: copies the plugin to ~/.escape-fm/openclaw and has OpenClaw load it
// from there (`openclaw plugins install --link`), which adds it to the plugins in OpenClaw's own
// configuration and leaves everything else in it as it was.
//
//   node install.mjs                 install, or update
//   node install.mjs --uninstall     take it out again (`openclaw plugins uninstall escape-fm`)
//   node install.mjs --print         copy the plugin, and print the command instead of running it
//
// Run it on the machine the OpenClaw gateway runs on, as the user it runs as.

import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME } from './scripts/lib.mjs'
import { greet, welcome } from './scripts/session.mjs'

const ID = 'escape-fm'
const root = path.dirname(fileURLToPath(import.meta.url))
const dest = path.join(HOME, 'openclaw')

/** Runs the openclaw CLI, showing what it says; null when there is none on the PATH. */
function openclaw(args) {
  const result = spawnSync('openclaw', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return result.error ? null : result.status
}

const show = (args) => ['openclaw', ...args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))].join(' ')

try {
  if (process.argv.includes('--uninstall')) {
    const args = ['plugins', 'uninstall', ID, '--force']
    if (openclaw(args) === null) console.log(`There is no openclaw command here. Where OpenClaw is installed, run: ${show(args)}`)
    rmSync(dest, { recursive: true, force: true })
    console.log(`Removed ${dest}. The pairing in ${path.join(HOME, 'config.json')} is kept: other integrations share it.`)
  } else {
    // the plugin and the scripts it runs; not this installer
    mkdirSync(path.join(dest, 'scripts'), { recursive: true })
    for (const name of ['index.js', 'openclaw.plugin.json', 'package.json']) copyFileSync(path.join(root, name), path.join(dest, name))
    for (const name of readdirSync(path.join(root, 'scripts'))) {
      if (name.endsWith('.mjs')) copyFileSync(path.join(root, 'scripts', name), path.join(dest, 'scripts', name))
    }
    console.log(`Copied the plugin to ${dest}.`)

    const args = ['plugins', 'install', '--link', dest]
    if (process.argv.includes('--print')) {
      console.log(`To have OpenClaw load it, run: ${show(args)}`)
    } else {
      // newer versions ask before linking a local folder, and take --force for yes when nobody is there to answer
      let status = openclaw(args)
      if (status !== null && status !== 0) status = openclaw([...args, '--force'])
      if (status === null) {
        console.log(`There is no openclaw command here. Where OpenClaw is installed, run: ${show(args)}`)
      } else if (status !== 0) {
        throw new Error(`OpenClaw did not take the plugin. Try it yourself: ${show(args)}`)
      } else {
        console.log('Added escape.fm to OpenClaw. Restart the gateway to load it: openclaw gateway restart')
      }
    }

    const first = greet()
    if (first) console.log(welcome(first, `To open the player paired with this machine: node "${path.join(dest, 'scripts', 'open.mjs')}"`))
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
