#!/usr/bin/env node
// Feeds each integration's hook script the events its agent sends, in the shape that
// agent documents, and checks what reaches the relay: the four fields and nothing else,
// under a User-Agent that names the integration and its version and nothing more.
// The relay here is a stand-in that only records requests; nothing leaves the machine
// and nothing outside a temporary folder is touched.
//
//   node scripts/test-integrations.mjs

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOOK = {
  claude: path.join(ROOT, 'plugin/scripts/hook.mjs'),
  codex: path.join(ROOT, 'integrations/codex/scripts/hook.mjs'),
  cursor: path.join(ROOT, 'integrations/cursor/scripts/hook.mjs'),
}
/** What each integration calls itself in its User-Agent, and where its version comes from. */
const CLIENT = {
  claude: { name: 'claude-code', manifest: 'plugin/.claude-plugin/plugin.json' },
  codex: { name: 'codex', manifest: 'integrations/codex/.codex-plugin/plugin.json' },
  cursor: { name: 'cursor', manifest: 'integrations/cursor/.cursor-plugin/plugin.json' },
}
/** The header, exactly: `escape-fm/<version> (<client>)`. */
const userAgent = (tool) => `escape-fm/${JSON.parse(readFileSync(path.join(ROOT, CLIENT[tool].manifest), 'utf8')).version} (${CLIENT[tool].name})`
const MODES = ['deep', 'debug', 'explore', 'ideate', 'analyze', 'polish', 'routine', 'plan']
const AGENTS = ['user', 'running', 'waiting', 'idle']

// Things an agent hands a hook that must never be sent or kept. Every event below carries some.
const PRIVATE = {
  cwd: '/Users/ada/work/orbital-billing',
  transcript: '/Users/ada/.agent/transcripts/9f2c.jsonl',
  file: '/Users/ada/work/orbital-billing/src/ledger/refunds.ts',
  command: 'cat .env.production | grep STRIPE',
  output: 'STRIPE_SECRET=sk_live_not_a_real_key',
  email: 'ada@orbital.example',
  reply: 'I changed refunds.ts so the ledger balances',
  words: 'zanzibar-quokka',
}
const SECRETS = Object.values(PRIVATE)

let failures = 0
async function test(name, body) {
  try {
    await body()
    console.log(`ok    ${name}`)
  } catch (error) {
    failures += 1
    console.log(`FAIL  ${name}\n      ${String(error.message).split('\n').join('\n      ')}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** A stand-in relay: answers as the real one does and keeps what it was sent. */
async function relay() {
  const seen = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body })
      res.setHeader('content-type', 'application/json')
      res.end('{"listeners":0}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    seen,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => server.close(),
    /** Reports from a detached process arrive a moment after the hook has returned. */
    async settle(count) {
      for (let i = 0; i < 100 && seen.length < count; i++) await sleep(50)
      if (seen.length === count) await sleep(150)
    },
  }
}

/** A machine of its own for one test: an empty home, and the stand-in as its relay. */
async function machine() {
  const home = mkdtempSync(path.join(tmpdir(), 'escape-fm-test-'))
  const server = await relay()
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    ESCAPE_FM_HOME: path.join(home, 'escape-fm'),
    ESCAPE_FM_API: server.url,
    ESCAPE_FM_NO_OPEN: '1',
    NO_PROXY: '127.0.0.1',
  }
  return { home, env, server, fm: env.ESCAPE_FM_HOME, done: () => (server.close(), rmSync(home, { recursive: true, force: true })) }
}

function run(script, args, input, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (err += chunk))
    child.on('close', (code) => resolve({ code, out, err }))
    child.stdin.on('error', () => {})
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
  })
}

/**
 * Runs events through a hook script one at a time and says what each one posted:
 * 'agent/mode', 'end', or '-' for nothing.
 */
async function play(m, script, events) {
  const trace = []
  const outputs = []
  for (const [args, input] of events) {
    const before = m.server.seen.length
    const result = await run(script, args, input, m.env)
    await m.server.settle(before + 1)
    assert.equal(result.code, 0, `exit code for ${JSON.stringify(args)} ${input.hook_event_name ?? ''}`)
    assert.equal(result.err, '', 'a hook prints nothing on stderr')
    checkKept(m)
    outputs.push(result.out)
    const posted = m.server.seen.slice(before).map((request) => {
      const body = JSON.parse(request.body)
      return body.end ? 'end' : `${body.agent}/${body.mode}`
    })
    trace.push(posted.join('+') || '-')
  }
  return { trace, outputs }
}

function allFiles(folder) {
  if (!existsSync(folder)) return []
  return readdirSync(folder).flatMap((name) => {
    const file = path.join(folder, name)
    return statSync(file).isDirectory() ? allFiles(file) : [file]
  })
}

/** Nothing private is written down between hook runs either. Checked after every event: a session's file is gone once it ends. */
function checkKept(m) {
  for (const file of allFiles(m.fm)) {
    const text = readFileSync(file, 'utf8')
    for (const secret of SECRETS) assert.ok(!text.includes(secret), `kept in ${path.relative(m.fm, file)}: ${secret}`)
  }
}

/**
 * The promise, checked: exactly four fields go out, under the key, and nothing private is sent.
 * The one header that says anything beyond that names the integration and its version, openly.
 */
function checkPrivacy(m, ids, tool) {
  const key = JSON.parse(readFileSync(path.join(m.fm, 'config.json'), 'utf8')).key
  assert.ok(m.server.seen.length > 0, 'something was posted')
  for (const request of m.server.seen) {
    assert.equal(`${request.method} ${request.url}`, 'POST /v1/signal')
    assert.equal(request.headers.authorization, `Bearer ${key}`)
    assert.equal(request.headers['user-agent'], userAgent(tool))
    assert.match(request.headers['user-agent'], /^escape-fm\/\d+\.\d+\.\d+ \((claude-code|codex|cursor)\)$/)
    // what curl, or Node's fetch without it, sends besides, with the same value on every machine; anything more would be ours
    const generic = { 'accept-language': '*', 'sec-fetch-mode': 'cors' }
    for (const [name, value] of Object.entries(generic)) if (name in request.headers) assert.equal(request.headers[name], value)
    const known = ['host', 'accept', 'accept-encoding', 'content-type', 'content-length', 'authorization', 'user-agent', 'connection', ...Object.keys(generic)]
    const extra = Object.keys(request.headers).filter((name) => !known.includes(name))
    assert.deepEqual(extra, [], `headers sent: ${Object.keys(request.headers).join(', ')}`)
    const body = JSON.parse(request.body)
    const fields = Object.keys(body).sort().join(',')
    assert.ok(fields === 'agent,mode,session,ts' || fields === 'end,session,ts', `fields posted: ${fields}`)
    assert.match(body.session, /^[A-Za-z0-9_-]{16}$/)
    assert.ok(Math.abs(body.ts - Date.now()) < 60_000, 'ts is now')
    if (!body.end) {
      assert.ok(body.mode === null || MODES.includes(body.mode), `mode: ${body.mode}`)
      assert.ok(AGENTS.includes(body.agent), `agent: ${body.agent}`)
    }
    const wire = request.url + JSON.stringify(request.headers) + request.body
    for (const secret of [...SECRETS, ...ids]) assert.ok(!wire.includes(secret), `sent to the relay: ${secret}`)
  }
}

// ---------------------------------------------------------------- Claude Code

const claude = (session_id, hook_event_name, more = {}) => [
  [],
  { session_id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, permission_mode: 'default', hook_event_name, ...more },
]
const claudeTool = (id, event, tool_name) =>
  claude(id, event, { tool_name, tool_use_id: 'toolu_01', tool_input: { file_path: PRIVATE.file, command: PRIVATE.command }, tool_response: { stdout: PRIVATE.output } })

await test('Claude Code: events become the two tags', async () => {
  const m = await machine()
  const id = 'c0ffee00-1111-4222-8333-444455556666'
  const { trace, outputs } = await play(m, HOOK.claude, [
    claude(id, 'SessionStart', { source: 'startup' }),
    claude(id, 'UserPromptSubmit', { prompt: `why does the refund test fail? ${PRIVATE.words} ${PRIVATE.file}` }),
    claudeTool(id, 'PreToolUse', 'Read'),
    claudeTool(id, 'PostToolUse', 'Read'),
    claudeTool(id, 'PreToolUse', 'Bash'),
    claudeTool(id, 'PermissionRequest', 'Bash'),
    claude(id, 'Notification', { notification_type: 'permission_prompt', message: `Claude needs your permission to run ${PRIVATE.command}` }),
    claudeTool(id, 'PostToolUse', 'Bash'),
    claudeTool(id, 'PreToolUse', 'AskUserQuestion'),
    claudeTool(id, 'PostToolUse', 'AskUserQuestion'),
    claude(id, 'Stop', { last_assistant_message: PRIVATE.reply }),
    claude(id, 'UserPromptSubmit', { prompt: 'continue' }),
    claudeTool(id, 'PreToolUse', 'Edit'),
    claudeTool(id, 'PreToolUse', 'Write'),
    claude(id, 'StopFailure', { error: 'rate_limit' }),
    claude(id, 'UserPromptSubmit', { prompt: 'ok', permission_mode: 'plan' }),
    claude(id, 'PreCompact', { trigger: 'auto' }),
    claude(id, 'SessionEnd', { reason: 'other' }),
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'running/debug', '-', '-', 'waiting/debug', '-', 'running/debug', 'waiting/debug', 'running/debug', 'idle/debug',
    'user/debug', 'running/debug', 'running/deep', 'idle/deep', 'user/plan', '-', 'end',
  ])
  assert.deepEqual(JSON.parse(outputs[0]), { systemMessage: 'escape.fm is set up. Run /escape-fm:open to open the player paired with this machine.' })
  assert.ok(outputs.slice(1).every((out) => out === ''), 'only the first session start says anything')
  checkPrivacy(m, [id], 'claude')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [], 'the session is forgotten when it ends')
  m.done()
})

// ---------------------------------------------------------------------- Codex

const codex = (session_id, hook_event_name, more = {}) => [
  [],
  { session_id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, hook_event_name, model: 'gpt-5.5', permission_mode: 'default', turn_id: 'turn_7', ...more },
]
const codexTool = (id, event, tool_name, more = {}) =>
  codex(id, event, {
    tool_name,
    tool_use_id: 'call_01',
    tool_input: { command: PRIVATE.command, description: `run ${PRIVATE.command}` },
    ...(event === 'PostToolUse' ? { tool_response: { output: PRIVATE.output } } : {}),
    ...more,
  })

await test('Codex: events become the two tags', async () => {
  const m = await machine()
  const id = '019b2f6e-7a10-7c53-9d1e-5b1f0c0a9e11'
  const { trace, outputs } = await play(m, HOOK.codex, [
    codex(id, 'SessionStart', { source: 'startup' }),
    codex(id, 'UserPromptSubmit', { prompt: `fix the failing refund test ${PRIVATE.words} ${PRIVATE.file}` }),
    codexTool(id, 'PreToolUse', 'Bash'),
    codexTool(id, 'PermissionRequest', 'Bash'),
    codexTool(id, 'PostToolUse', 'Bash'),
    codexTool(id, 'PreToolUse', 'apply_patch'),
    codexTool(id, 'PostToolUse', 'apply_patch'),
    codexTool(id, 'PreToolUse', 'request_user_input'),
    codexTool(id, 'PostToolUse', 'request_user_input'),
    // compaction in the middle of a turn: the agent is not idle
    codex(id, 'SessionStart', { source: 'compact' }),
    // a subagent's prompt arrives under the parent's session: not the listener, not read
    codex(id, 'UserPromptSubmit', { prompt: `research the docs and brainstorm ideas ${PRIVATE.words}`, agent_id: 'agent_2', agent_type: 'explorer' }),
    codexTool(id, 'PreToolUse', 'Bash', { agent_id: 'agent_2', agent_type: 'explorer' }),
    codex(id, 'Stop', { stop_hook_active: false, last_assistant_message: PRIVATE.reply }),
    codex(id, 'UserPromptSubmit', { prompt: 'continue' }),
    codexTool(id, 'PreToolUse', 'apply_patch'),
    codexTool(id, 'PreToolUse', 'apply_patch'),
    codex(id, 'Interrupt'),
    codex(id, 'UserPromptSubmit', { prompt: 'go on', permission_mode: 'plan' }),
    codex(id, 'SubagentStop', { agent_id: 'agent_2', agent_type: 'explorer', last_assistant_message: PRIVATE.reply }),
    [[], { session_id: id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, hook_event_name: 'SessionEnd', reason: 'other' }],
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'running/debug', 'waiting/debug', 'running/debug', '-', '-', 'waiting/debug', 'running/debug',
    '-', '-', '-', 'idle/debug', 'user/debug', 'running/debug', 'running/deep', 'idle/deep', 'user/plan', '-', 'end',
  ])
  const said = JSON.parse(outputs[0]).systemMessage
  assert.match(said, /^escape\.fm is set up\. To open the player paired with this machine, run in your own terminal: node ".*open\.mjs"$/)
  assert.ok(outputs.slice(1).every((out) => out === ''), 'no other event prints anything, so Codex is never answered')
  checkPrivacy(m, [id], 'codex')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// --------------------------------------------------------------------- Cursor

const cursor = (event, conversation_id, more = {}, args = [event]) => [
  args,
  {
    conversation_id,
    generation_id: 'gen_42',
    model: 'claude-opus-4-7-thinking-max',
    hook_event_name: event,
    cursor_version: '3.4.1',
    workspace_roots: [PRIVATE.cwd],
    user_email: PRIVATE.email,
    transcript_path: PRIVATE.transcript,
    ...more,
  },
]
const cursorTool = (event, id, tool_name, more = {}) =>
  cursor(event, id, {
    tool_name,
    tool_input: { command: PRIVATE.command, file_path: PRIVATE.file },
    tool_use_id: 'abc123',
    cwd: PRIVATE.cwd,
    ...(event === 'postToolUse' ? { tool_output: JSON.stringify({ stdout: PRIVATE.output }), duration: 5432 } : {}),
    ...(event === 'postToolUseFailure' ? { error_message: PRIVATE.output, failure_type: 'error', duration: 12, is_interrupt: false } : {}),
    ...more,
  })

await test('Cursor: events become the two tags, and Cursor is never answered', async () => {
  const m = await machine()
  const id = '7d1f6f0e-52b4-4d5a-9a57-0f6a2f6f3c10'
  const helper = 'a5b0c9d8-0000-4000-8000-subagent0001'
  const { trace, outputs } = await play(m, HOOK.cursor, [
    cursor('sessionStart', id, { session_id: id, is_background_agent: false, composer_mode: 'agent' }),
    // tools of a conversation that never had a message: a subagent under an id of its own
    cursorTool('preToolUse', helper, 'Shell'),
    cursorTool('postToolUse', helper, 'Shell'),
    cursor('beforeSubmitPrompt', id, { prompt: `why is the refund job crashing? ${PRIVATE.words}`, attachments: [{ type: 'file', file_path: PRIVATE.file }] }),
    cursorTool('preToolUse', id, 'Shell'),
    cursorTool('postToolUse', id, 'Shell'),
    cursorTool('preToolUse', id, 'AskQuestion'),
    cursorTool('postToolUse', id, 'AskQuestion'),
    cursorTool('postToolUseFailure', id, 'Shell'),
    cursor('stop', id, { status: 'completed', loop_count: 0 }),
    cursor('beforeSubmitPrompt', id, { prompt: 'ok', attachments: [] }),
    cursorTool('preToolUse', id, 'Read'),
    cursorTool('preToolUse', id, 'Grep'),
    cursorTool('preToolUse', id, 'Read'),
    cursorTool('preToolUse', id, 'WebSearch'),
    // the listener stops a tool: the turn is ending, and `stop` says so
    cursorTool('postToolUseFailure', id, 'Shell', { is_interrupt: true }),
    cursor('stop', id, { status: 'aborted', loop_count: 0 }),
    // the event is named by the payload alone when hooks.json does not pass it
    cursor('beforeSubmitPrompt', id, { prompt: 'write a draft of the changelog' }, []),
    cursor('afterAgentThought', id, { text: PRIVATE.reply, duration_ms: 5000 }),
    cursor('sessionEnd', id, { session_id: id, reason: 'user_close', duration_ms: 45000, is_background_agent: false, final_status: 'completed' }),
  ])
  assert.deepEqual(trace, [
    '-', '-', '-', 'user/debug', 'running/debug', '-', 'waiting/debug', 'running/debug', '-', 'idle/debug',
    'user/debug', 'running/debug', '-', '-', 'running/explore', '-', 'idle/explore', 'user/deep', '-', 'end',
  ])
  assert.ok(outputs.every((out) => out === ''), 'nothing is printed, so no hook is ever answered for Cursor')
  checkPrivacy(m, [id, helper], 'cursor')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// ------------------------------------------------------------ the three alike

const first = {
  claude: claude('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  codex: codex('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  cursor: cursor('beforeSubmitPrompt', 's-1', { prompt: 'fix the bug' }),
}

for (const [name, script] of Object.entries(HOOK)) {
  await test(`${name}: ESCAPE_FM_DISABLE sends nothing and writes nothing`, async () => {
    const m = await machine()
    const [args, input] = first[name]
    const result = await run(script, args, input, { ...m.env, ESCAPE_FM_DISABLE: '1' })
    await sleep(300)
    assert.deepEqual([result.code, result.out, result.err], [0, '', ''])
    assert.equal(m.server.seen.length, 0)
    assert.ok(!existsSync(m.fm), 'no key, no state')
    m.done()
  })

  await test(`${name}: an unreachable relay and an unreadable event are both silent`, async () => {
    const m = await machine()
    m.server.close()
    const [args, input] = first[name]
    const down = await run(script, args, input, m.env)
    assert.deepEqual([down.code, down.out, down.err], [0, '', ''])
    const garbage = await run(script, args, 'not json', m.env)
    assert.deepEqual([garbage.code, garbage.out, garbage.err], [0, '', ''])
    const empty = await run(script, args, '{}', m.env)
    assert.deepEqual([empty.code, empty.out, empty.err], [0, '', ''])
    m.done()
  })

  await test(`${name}: every event in its hooks.json runs this script`, () => {
    const file = name === 'claude' ? 'plugin/hooks/hooks.json' : `integrations/${name}/hooks/hooks.json`
    const { hooks } = JSON.parse(readFileSync(path.join(ROOT, file), 'utf8'))
    const handlers = Object.values(hooks).flat().flatMap((item) => item.hooks ?? [item])
    assert.ok(handlers.length >= 7)
    for (const handler of handlers) assert.match(JSON.stringify(handler), /scripts\/hook\.mjs/)
  })
}

await test('without curl, the fallback sends the same four fields under the same User-Agent', async () => {
  const m = await machine()
  // a PATH with nothing on it: the hook runs on node by its full path, and curl cannot be found
  const empty = path.join(m.home, 'no-bin')
  mkdirSync(empty)
  const env = { ...m.env, PATH: empty }
  const id = 'f00dfeed-0000-4000-8000-000000000001'
  const { trace } = await play({ ...m, env }, HOOK.claude, [
    claude(id, 'UserPromptSubmit', { prompt: `fix the refund test ${PRIVATE.words}` }),
    claude(id, 'SessionEnd', { reason: 'other' }),
  ])
  assert.deepEqual(trace, ['user/debug', 'end'])
  checkPrivacy(m, [id], 'claude')
  m.done()
})

await test('the player is opened once, at the first session start after the key is made', async () => {
  const m = await machine()
  // the integration was switched on in the middle of a session: the key is made by a prompt
  const { outputs } = await play(m, HOOK.codex, [
    codex('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
    codex('s-2', 'SessionStart', { source: 'startup' }),
    codex('s-3', 'SessionStart', { source: 'startup' }),
  ])
  assert.equal(outputs[0], '')
  assert.match(outputs[1], /escape\.fm is set up/)
  assert.equal(outputs[2], '')
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(m.fm, 'config.json'), 'utf8'))), ['key'])
  m.done()
})

await test('a key made before this version is kept, and is not welcomed again', async () => {
  const m = await machine()
  mkdirSync(m.fm, { recursive: true })
  const key = 'k'.repeat(32)
  writeFileSync(path.join(m.fm, 'config.json'), JSON.stringify({ key }) + '\n')
  const { outputs } = await play(m, HOOK.claude, [claude('s-1', 'SessionStart', { source: 'startup' })])
  assert.equal(outputs[0], '')
  assert.equal(m.server.seen[0].headers.authorization, `Bearer ${key}`)
  m.done()
})

// ------------------------------------------------------------------ installers

const others = {
  codex: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/policy.py' }] }] } },
  cursor: { version: 1, hooks: { afterFileEdit: [{ command: './hooks/format.sh' }], stop: [{ command: './hooks/audit.sh', loop_limit: 10 }] } },
}

for (const tool of ['codex', 'cursor']) {
  await test(`${tool}: install.mjs adds the hooks beside what is there, and takes out only its own`, async () => {
    const m = await machine()
    const dir = path.join(m.home, `dot-${tool}`)
    const file = path.join(dir, 'hooks.json')
    const install = path.join(ROOT, `integrations/${tool}/install.mjs`)
    const env = { ...m.env, CODEX_HOME: path.join(m.home, 'not-used') }

    const missing = await run(install, ['--dir', dir], '', env)
    assert.equal(missing.code, 1, 'refuses a folder that is not there')
    assert.ok(!existsSync(dir))

    mkdirSync(dir)
    writeFileSync(file, JSON.stringify(others[tool], null, 2) + '\n')
    const printed = await run(install, ['--dir', dir, '--print'], '', env)
    assert.equal(printed.code, 0)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), others[tool], '--print writes nothing to hooks.json')

    for (const round of [1, 2]) {
      const result = await run(install, ['--dir', dir], '', env)
      assert.equal(result.code, 0, result.err)
      const config = JSON.parse(readFileSync(file, 'utf8'))
      const script = path.join(m.fm, tool, 'hook.mjs')
      const commands = Object.values(config.hooks).flat().flatMap((item) => item.hooks ?? [item]).map((handler) => handler.command)
      const ours = commands.filter((command) => command.includes(script))
      const template = JSON.parse(readFileSync(path.join(ROOT, `integrations/${tool}/hooks/hooks.json`), 'utf8')).hooks
      assert.equal(ours.length, Object.keys(template).length, `round ${round}: one handler an event, not doubled by installing again`)
      assert.ok(ours.every((command) => command.startsWith(`node "${script}"`)), 'the hooks run the installed copy by its full path')
      for (const [event, list] of Object.entries(others[tool].hooks)) assert.deepEqual(config.hooks[event].slice(0, list.length), list, 'what was there is kept, first')
      assert.ok(existsSync(script) && existsSync(path.join(m.fm, tool, 'session.mjs')) && !existsSync(path.join(m.fm, tool, 'setup.mjs')))
    }

    // the installed copy works from where it was put
    const [args, input] = first[tool]
    await run(path.join(m.fm, tool, 'hook.mjs'), args, input, env)
    await m.server.settle(1)
    assert.equal(JSON.parse(m.server.seen[0].body).agent, 'user')
    assert.equal(m.server.seen[0].headers['user-agent'], userAgent(tool), 'the installed copy says which integration it is')

    const removed = await run(install, ['--dir', dir, '--uninstall'], '', env)
    assert.equal(removed.code, 0, removed.err)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), others[tool], 'hooks.json is as it was')
    assert.ok(!existsSync(path.join(m.fm, tool)), 'the scripts are gone')
    assert.ok(existsSync(path.join(m.fm, 'config.json')), 'the pairing is kept')
    m.done()
  })
}

await test('install.mjs leaves a hooks.json it cannot read alone', async () => {
  const m = await machine()
  const dir = path.join(m.home, 'dot-cursor')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'hooks.json'), '{ "version": 1, "hooks": { // mine\n } }')
  const result = await run(path.join(ROOT, 'integrations/cursor/install.mjs'), ['--dir', dir], '', m.env)
  assert.equal(result.code, 1)
  assert.match(readFileSync(path.join(dir, 'hooks.json'), 'utf8'), /\/\/ mine/)
  m.done()
})

await test('the copies of shared/ are in sync', async () => {
  const result = await run(path.join(ROOT, 'scripts/sync-integrations.mjs'), ['--check'], '', { PATH: process.env.PATH })
  assert.equal(result.code, 0, result.err)
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
