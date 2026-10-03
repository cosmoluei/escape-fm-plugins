// A copy of shared/lines.mjs, written by scripts/sync-integrations.mjs. Edit it there.
// Lines of code, counted from git in the session's folder, and only when the listener has asked for
// them (docs/integrations.md, "Asked for: lines and usage"). Three numbers leave this file: lines
// added, lines removed, commits made. No file name, commit message or diff is read into this
// process: git is asked only for its totals. The commit a session started from is kept in the
// session's state file, on this machine, to count from.

import { execFileSync } from 'node:child_process'

/** A hook must not keep its agent waiting, so a git that takes longer is given up on. */
const TIMEOUT = 2000

/** One git command in `cwd`, its output, or null: not a repository, no git, too slow, anything else. */
function git(cwd, args) {
  try {
    const out = execFileSync('git', ['--no-optional-locks', ...args], {
      cwd,
      timeout: TIMEOUT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      // git's totals in English whatever the machine's language, so they can be read
      env: { ...process.env, LC_ALL: 'C' },
      maxBuffer: 64 * 1024,
      windowsHide: true,
    })
    return out.trim()
  } catch {
    return null
  }
}

/** `git diff --shortstat`'s one line, "3 files changed, 10 insertions(+), 2 deletions(-)", as two numbers. */
function shortstat(text) {
  return {
    added: Number(text.match(/(\d+) insertions?\(\+\)/)?.[1] ?? 0),
    removed: Number(text.match(/(\d+) deletions?\(-\)/)?.[1] ?? 0),
  }
}

/**
 * Where the session starts from: the commit checked out, and the changes not yet committed then,
 * which are not the session's work. `{ head: null }` where there is nothing to count from (not a
 * repository, no commit yet, git missing or too slow), so git is not asked again in this session.
 * @param {string} cwd the session's folder
 */
export function baseline(cwd) {
  const head = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])
  if (!head || !/^[0-9a-f]{40,64}$/.test(head)) return { head: null }
  const diff = git(cwd, ['diff', '--no-ext-diff', '--shortstat', head])
  if (diff === null) return { head: null }
  return { head, ...shortstat(diff), high: { added: 0, removed: 0, commits: 0 } }
}

/**
 * What the session has added since its last report: lines added and removed in the working tree
 * against the commit it started from (its commits and what is not committed yet), less what was
 * there already, and the commits made since. Each number is counted from its highest so far, so a
 * change undone and made again is not counted twice; `base.high` is raised to match.
 * @param {{ head: string | null, added?: number, removed?: number, high?: { added: number, removed: number, commits: number } }} base from `baseline`
 * @param {string} cwd the session's folder
 * @returns {{ added: number, removed: number, commits: number } | null} null when there is nothing to send
 */
export function growth(base, cwd) {
  if (!base?.head || !base.high) return null
  const diff = git(cwd, ['diff', '--no-ext-diff', '--shortstat', base.head])
  const count = git(cwd, ['rev-list', '--count', `${base.head}..HEAD`])
  if (diff === null || count === null || !/^\d+$/.test(count)) return null
  const now = shortstat(diff)
  const value = {
    added: Math.max(0, now.added - base.added),
    removed: Math.max(0, now.removed - base.removed),
    commits: Number(count),
  }
  const grown = {}
  for (const name of ['added', 'removed', 'commits']) {
    grown[name] = Math.max(0, value[name] - base.high[name])
    base.high[name] = Math.max(base.high[name], value[name])
  }
  return grown.added || grown.removed || grown.commits ? grown : null
}
