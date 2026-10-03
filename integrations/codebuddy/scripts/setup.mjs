// A copy of shared/setup.mjs, written by scripts/sync-integrations.mjs. Edit it there.
// Installs an integration by hand, for an agent that is not given it as a plugin:
// copies the integration's scripts to a folder of their own under ~/.escape-fm and
// adds its hooks to the agent's configuration file, beside whatever is there already.
// Uninstalling takes out exactly what was added. Used by each integration's install.mjs.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { HOME } from './lib.mjs'
import { greet, welcome } from './session.mjs'

/**
 * How an integration's own hooks.json names its hook script: from a plugin's or an extension's root
 * (`${PLUGIN_ROOT}`, `${extensionPath}`, …, or `./`), quoted or not.
 */
const PLACE = /"?(?:\$\{[A-Za-z_]+\}|\.)\/scripts\/hook\.mjs"?/

/** The value that follows a flag on the command line. */
export function option(name) {
  const at = process.argv.indexOf(name)
  return at > 0 ? process.argv[at + 1] : undefined
}

/** Both shapes of hooks.json: handlers listed directly under an event (Cursor, Copilot), or in groups with a matcher (Codex and most). */
const mapHandlers = (list, change) =>
  list.flatMap((item) => {
    if (!Array.isArray(item?.hooks)) return change(item)
    const hooks = item.hooks.flatMap(change)
    return hooks.length ? [{ ...item, hooks }] : []
  })

/** An agent's hooks without ours: every handler that runs the script we installed. */
function without(hooks, script) {
  const kept = {}
  for (const [event, list] of Object.entries(hooks ?? {})) {
    // not a list of hooks: something of the agent's own, left as it is
    if (!Array.isArray(list)) {
      kept[event] = list
      continue
    }
    const rest = mapHandlers(list, (handler) => (typeof handler?.command === 'string' && handler.command.includes(script) ? [] : [handler]))
    if (rest.length) kept[event] = rest
  }
  return kept
}

function readHooks(file, blank) {
  if (!existsSync(file)) return blank
  try {
    const found = JSON.parse(readFileSync(file, 'utf8'))
    if (found && typeof found === 'object' && !Array.isArray(found)) return found
  } catch {
    // reported below
  }
  throw new Error(`${file} is not a JSON object. Nothing was changed; fix or move that file, then run this again.`)
}

/**
 * @param {object} options
 * @param {string} options.tool the folder under ~/.escape-fm for the scripts: 'codex', 'cursor'
 * @param {string} options.agent the agent's name, for what is printed
 * @param {string} options.root the integration's folder, holding hooks/hooks.json and scripts/
 * @param {string} options.dir the agent's configuration folder, holding the file below
 * @param {string} [options.file] the file in it that holds the hooks: hooks.json, or the agent's settings.json
 * @param {boolean} [options.wrapped] the events are under `hooks` in that file; false: the file is the events themselves (Droid)
 * @param {boolean} [options.own] the file is this integration's alone (a folder of hook files, as Copilot's): uninstalling removes it
 * @param {boolean} [options.create] make that folder if it is not there (a project's, not the agent's own)
 * @param {object} options.blank the file with nothing in it, as this agent wants it
 * @param {string[]} [options.after] what is left for the listener to do in the agent
 */
export function setup({ tool, agent, root, dir, file: name = 'hooks.json', wrapped = true, own = false, create = false, blank, after = [] }) {
  const dest = path.join(HOME, tool)
  const script = path.join(dest, 'hook.mjs')
  const file = path.join(dir, name)
  // the events in a file, and a file with these events, in this agent's shape
  const eventsOf = (config) => (wrapped ? config.hooks : config)
  const withEvents = (config, hooks) => (wrapped ? { ...blank, ...config, hooks } : hooks)

  try {
    if (process.argv.includes('--uninstall')) {
      if (existsSync(file) && own) {
        rmSync(file)
        console.log(`Removed ${file}.`)
      } else if (existsSync(file)) {
        const config = readHooks(file, blank)
        const kept = without(eventsOf(config), script)
        writeFileSync(file, JSON.stringify(wrapped ? { ...config, hooks: kept } : kept, null, 2) + '\n')
        console.log(`Took the escape.fm hooks out of ${file}.`)
      }
      rmSync(dest, { recursive: true, force: true })
      console.log(`Removed ${dest}. The pairing in ${path.join(HOME, 'config.json')} is kept: other integrations share it.`)
      return
    }

    // the integration's own hooks.json, with its events under `hooks` or (Droid's) the events themselves
    const shipped = JSON.parse(readFileSync(path.join(root, 'hooks', 'hooks.json'), 'utf8'))
    const template = shipped.hooks && typeof shipped.hooks === 'object' && !Array.isArray(shipped.hooks) ? shipped.hooks : shipped
    const ours = {}
    for (const [event, list] of Object.entries(template)) {
      ours[event] = mapHandlers(list, (handler) => [{ ...handler, command: handler.command.replace(PLACE, () => `"${script}"`) }])
    }

    const print = process.argv.includes('--print')
    if (!print && !existsSync(dir) && !create) {
      throw new Error(`There is no ${dir}. If ${agent} keeps its configuration somewhere else, pass that folder with --dir.`)
    }
    const config = print ? blank : readHooks(file, blank)

    mkdirSync(dest, { recursive: true })
    for (const name of readdirSync(path.join(root, 'scripts'))) {
      if (name.endsWith('.mjs') && name !== 'setup.mjs') copyFileSync(path.join(root, 'scripts', name), path.join(dest, name))
    }
    console.log(`Copied the hook scripts to ${dest}.`)

    const kept = without(eventsOf(config), script)
    const hooks = { ...kept }
    for (const [event, list] of Object.entries(ours)) hooks[event] = [...(kept[event] ?? []), ...list]
    const merged = JSON.stringify(withEvents(config, hooks), null, 2) + '\n'

    if (print) {
      console.log(`Add these to ${file}:\n\n${merged}`)
    } else {
      mkdirSync(dir, { recursive: true })
      writeFileSync(file, merged)
      console.log(`Added the escape.fm hooks to ${file}.`)
    }
    for (const line of after) console.log(line)

    const first = greet()
    if (first) console.log(welcome(first, `To open the player paired with this machine: node "${path.join(dest, 'open.mjs')}"`))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
