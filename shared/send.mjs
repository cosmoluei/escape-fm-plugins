#!/usr/bin/env node
// Posts one report, read from stdin. A hook that its agent waits on starts this as
// a process of its own and returns, so the agent never waits for the network.

import { readFileSync } from 'node:fs'
import { loadConfig, post } from './lib.mjs'

async function main() {
  await post(loadConfig(), JSON.parse(readFileSync(0, 'utf8')))
}

main().catch(() => {})
