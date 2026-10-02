#!/usr/bin/env node
// A copy of shared/open.mjs, written by scripts/sync-integrations.mjs. Edit it there.
// Opens the player paired with this machine. `--print` prints the pairing link
// instead, for machines without a browser; run that one in your own terminal,
// since the link carries this machine's listener key.

import { headless, loadConfig, openBrowser, pairingUrl, welcomed } from './lib.mjs'

const config = loadConfig()
const url = pairingUrl(config)
// asked for by hand, so a session start need not open the player by itself later
welcomed()

if (process.argv.includes('--print')) {
  console.log(url)
} else if (!headless() && openBrowser(url)) {
  console.log('Opened the escape.fm player, paired with this machine.')
} else {
  console.log('No browser to open here. In your own terminal, run this script with --print and open the link it prints on the machine you listen on.')
}
