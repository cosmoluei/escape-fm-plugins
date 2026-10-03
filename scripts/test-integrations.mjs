#!/usr/bin/env node
// Feeds each integration's hook script the events its agent sends, in the shape that
// agent documents, and checks what reaches the relay: the four fields, the computer's
// name, whether the agent's steps went through, and nothing else, under a User-Agent
// that names the integration and its version and nothing more.
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
  qwen: path.join(ROOT, 'integrations/qwen/scripts/hook.mjs'),
  gemini: path.join(ROOT, 'integrations/gemini/scripts/hook.mjs'),
  copilot: path.join(ROOT, 'integrations/copilot/scripts/hook.mjs'),
  droid: path.join(ROOT, 'integrations/droid/scripts/hook.mjs'),
  codebuddy: path.join(ROOT, 'integrations/codebuddy/scripts/hook.mjs'),
  workbuddy: path.join(ROOT, 'integrations/workbuddy/scripts/hook.mjs'),
  muse: path.join(ROOT, 'integrations/muse/scripts/hook.mjs'),
  openclaw: path.join(ROOT, 'integrations/openclaw/scripts/hook.mjs'),
}
/** What each integration calls itself in its User-Agent, and where its version comes from. */
const CLIENT = {
  claude: { name: 'claude-code', manifest: 'plugin/.claude-plugin/plugin.json' },
  codex: { name: 'codex', manifest: 'integrations/codex/.codex-plugin/plugin.json' },
  cursor: { name: 'cursor', manifest: 'integrations/cursor/.cursor-plugin/plugin.json' },
  qwen: { name: 'qwen-code', manifest: 'integrations/qwen/qwen-extension.json' },
  gemini: { name: 'gemini-cli', manifest: 'integrations/gemini/gemini-extension.json' },
  copilot: { name: 'copilot-cli', manifest: 'integrations/copilot/plugin.json' },
  droid: { name: 'droid', manifest: 'integrations/droid/.factory-plugin/plugin.json' },
  codebuddy: { name: 'codebuddy', manifest: 'integrations/codebuddy/.codebuddy-plugin/plugin.json' },
  workbuddy: { name: 'workbuddy', manifest: 'integrations/workbuddy/.workbuddy-plugin/plugin.json' },
  muse: { name: 'muse-code', manifest: 'integrations/muse/manifest.json' },
  openclaw: { name: 'openclaw', manifest: 'integrations/openclaw/openclaw.plugin.json' },
}
/** An integration's own hooks.json: where its events are (Droid's file is the events themselves). */
const hooksFile = (tool) => (tool === 'claude' ? 'plugin/hooks/hooks.json' : `integrations/${tool}/hooks/hooks.json`)
const eventsIn = (config) => (config.hooks && typeof config.hooks === 'object' && !Array.isArray(config.hooks) ? config.hooks : config)
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
  return { home, env, server, fm: env.ESCAPE_FM_HOME, since: Date.now(), done: () => (server.close(), rmSync(home, { recursive: true, force: true })) }
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
 * 'agent/mode', 'end', or '-' for nothing; with outcomes, ':' and one sign for each,
 * '+' for a step that went through and 'x' for one that failed.
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
      const steps = body.outcomes ? ':' + body.outcomes.map((ok) => (ok ? '+' : 'x')).join('') : ''
      return body.end ? 'end' : `${body.agent}/${body.mode}${steps}`
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
 * The promise, checked: exactly four fields go out, and the computer's name and the outcomes, under the key, and nothing private is sent.
 * The one header that says anything beyond that names the integration and its version, openly.
 */
function checkPrivacy(m, ids, tool) {
  const key = JSON.parse(readFileSync(path.join(m.fm, 'config.json'), 'utf8')).key
  assert.ok(m.server.seen.length > 0, 'something was posted')
  for (const request of m.server.seen) {
    assert.equal(`${request.method} ${request.url}`, 'POST /v1/signal')
    assert.equal(request.headers.authorization, `Bearer ${key}`)
    assert.equal(request.headers['user-agent'], userAgent(tool))
    assert.match(request.headers['user-agent'], /^escape-fm\/\d+\.\d+\.\d+ \((claude-code|codex|cursor|qwen-code|gemini-cli|copilot-cli|droid|codebuddy|workbuddy|muse-code|openclaw)\)$/)
    // what curl, or Node's fetch without it, sends besides, with the same value on every machine; anything more would be ours
    const generic = { 'accept-language': '*', 'sec-fetch-mode': 'cors' }
    for (const [name, value] of Object.entries(generic)) if (name in request.headers) assert.equal(request.headers[name], value)
    const known = ['host', 'accept', 'accept-encoding', 'content-type', 'content-length', 'authorization', 'user-agent', 'connection', ...Object.keys(generic)]
    const extra = Object.keys(request.headers).filter((name) => !known.includes(name))
    assert.deepEqual(extra, [], `headers sent: ${Object.keys(request.headers).join(', ')}`)
    const body = JSON.parse(request.body)
    const fields = Object.keys(body).filter((name) => name !== 'outcomes').sort().join(',')
    assert.ok(
      fields === 'agent,computer,mode,session,ts' || fields === 'agent,mode,session,ts' || (fields === 'end,session,ts' && !('outcomes' in body)),
      `fields posted: ${Object.keys(body).sort().join(',')}`,
    )
    if ('outcomes' in body) {
      // yes or no for each step, and nothing of what the step was
      assert.ok(Array.isArray(body.outcomes) && body.outcomes.length > 0 && body.outcomes.length <= 32, `outcomes: ${JSON.stringify(body.outcomes)}`)
      assert.ok(body.outcomes.every((ok) => typeof ok === 'boolean'), `outcomes: ${JSON.stringify(body.outcomes)}`)
    }
    if ('computer' in body) {
      assert.equal(typeof body.computer, 'string')
      assert.ok(body.computer.length > 0 && [...body.computer].length <= 40, `computer: ${body.computer}`)
    }
    assert.match(body.session, /^[A-Za-z0-9_-]{16}$/)
    // when the hook ran: within this test, however long a slow machine took over it
    assert.ok(body.ts >= m.since - 1000 && body.ts <= Date.now() + 1000, 'ts is now')
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
const claudeFailure = (id, tool_name, more = {}) =>
  claude(id, 'PostToolUseFailure', { tool_name, tool_use_id: 'toolu_02', tool_input: { file_path: PRIVATE.file, command: PRIVATE.command }, error: PRIVATE.output, is_interrupt: false, ...more })

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
    // an edit that did not apply, a command that failed: kept, and sent with the next report
    claudeFailure(id, 'Edit'),
    claudeTool(id, 'PreToolUse', 'Bash'),
    claudeFailure(id, 'Bash'),
    // a search that found nothing is not the agent failing, nor is a tool the listener stopped
    claudeFailure(id, 'Grep'),
    claudeFailure(id, 'Bash', { is_interrupt: true }),
    claudeTool(id, 'PreToolUse', 'Write'),
    claudeTool(id, 'PostToolUse', 'Write'),
    claude(id, 'StopFailure', { error: 'rate_limit' }),
    claude(id, 'UserPromptSubmit', { prompt: 'ok', permission_mode: 'plan' }),
    claude(id, 'PreCompact', { trigger: 'auto' }),
    claude(id, 'SessionEnd', { reason: 'other' }),
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'running/debug', '-', '-', 'waiting/debug', '-', 'running/debug:+', 'waiting/debug', 'running/debug', 'idle/debug',
    'user/debug', 'running/debug', '-', '-', '-', '-', '-', 'running/deep:xx', '-', 'idle/deep:+', 'user/plan', '-', 'end',
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
    // a command the listener would not allow did not fail
    cursorTool('postToolUseFailure', id, 'Shell', { failure_type: 'permission_denied' }),
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
    '-', '-', '-', 'user/debug', 'running/debug', '-', 'waiting/debug:+', 'running/debug', '-', '-', 'idle/debug:x',
    'user/debug', 'running/debug', '-', '-', 'running/explore', '-', 'idle/explore', 'user/deep', '-', 'end',
  ])
  assert.ok(outputs.every((out) => out === ''), 'nothing is printed, so no hook is ever answered for Cursor')
  checkPrivacy(m, [id, helper], 'cursor')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// ----------------------------------------------------------------- Qwen Code

const qwen = (session_id, hook_event_name, more = {}) => [
  [],
  {
    session_id,
    transcript_path: PRIVATE.transcript,
    cwd: PRIVATE.cwd,
    hook_event_name,
    timestamp: '2026-10-02T09:30:00.000Z',
    permission_mode: 'default',
    prompt_id: 'prompt-1',
    ...more,
  },
]
const qwenTool = (id, event, tool_name, more = {}) =>
  qwen(id, event, {
    tool_name,
    tool_input: { command: PRIVATE.command, file_path: PRIVATE.file },
    tool_use_id: 'toolu_01',
    tool_call_id: 'call_01',
    ...(event === 'PostToolUse' ? { tool_response: { llmContent: PRIVATE.output, returnDisplay: PRIVATE.output }, duration_ms: 812 } : {}),
    ...(event === 'PostToolUseFailure' ? { error: `Exit code 1\n${PRIVATE.output}`, is_interrupt: false, duration_ms: 812 } : {}),
    ...more,
  })

await test('Qwen Code: events become the two tags, and the outcomes', async () => {
  const m = await machine()
  const id = '5c0b3e1a-7d2f-4e8a-9b61-2f4d6c8e0a11'
  const words = `why does the refund test fail? ${PRIVATE.words}`
  const { trace, outputs } = await play(m, HOOK.qwen, [
    qwen(id, 'SessionStart', { source: 'startup', model: 'qwen3-coder-plus' }),
    qwen(id, 'UserPromptSubmit', { prompt: words, submitted_prompt: words }),
    qwenTool(id, 'PermissionRequest', 'run_shell_command', { permission_suggestions: [] }),
    qwen(id, 'Notification', { notification_type: 'permission_prompt', message: `Qwen Code needs your permission to run ${PRIVATE.command}` }),
    qwenTool(id, 'PreToolUse', 'run_shell_command'),
    // a command that exits with an error: kept, and sent with the next report
    qwenTool(id, 'PostToolUseFailure', 'run_shell_command'),
    // the call to the model with the tool's result: not the listener, and not read
    qwen(id, 'UserPromptSubmit', { prompt: `tool result: ${PRIVATE.output}` }),
    // a subagent's prompt: not the listener either
    qwen(id, 'UserPromptSubmit', { prompt: `brainstorm ideas ${PRIVATE.words}`, agent_id: 'agent-1' }),
    qwenTool(id, 'PreToolUse', 'edit'),
    qwenTool(id, 'PostToolUse', 'edit'),
    qwenTool(id, 'PreToolUse', 'read_file'),
    qwenTool(id, 'PostToolUse', 'read_file'),
    // stopped by the listener: no outcome
    qwenTool(id, 'PostToolUseFailure', 'run_shell_command', { is_interrupt: true }),
    qwen(id, 'Stop', { stop_hook_active: false, last_assistant_message: PRIVATE.reply, background_tasks: [], crons: [] }),
    qwen(id, 'UserPromptSubmit', { prompt: 'continue', submitted_prompt: 'continue' }),
    qwenTool(id, 'PreToolUse', 'edit'),
    qwenTool(id, 'PreToolUse', 'write_file'),
    qwenTool(id, 'PreToolUse', 'ask_user_question'),
    qwen(id, 'StopFailure', { error: 'rate_limit', error_details: PRIVATE.output }),
    qwen(id, 'UserPromptSubmit', { prompt: 'plan it', submitted_prompt: 'ok', permission_mode: 'plan' }),
    qwen(id, 'PreCompact', { trigger: 'auto' }),
    qwen(id, 'SessionEnd', { reason: 'prompt_input_exit' }),
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'waiting/debug', '-', 'running/debug', '-', '-', '-', '-', '-', '-', '-', '-', 'idle/debug:x+',
    'user/debug', 'running/debug', 'running/deep', 'waiting/deep', 'idle/deep', 'user/plan', '-', 'end',
  ])
  const said = JSON.parse(outputs[0]).systemMessage
  assert.match(said, /^escape\.fm is set up\. To open the player paired with this machine, run in your own terminal: node ".*open\.mjs"$/)
  assert.ok(outputs.slice(1).every((out) => out === ''), 'nothing else is printed, so nothing reaches the model')
  checkPrivacy(m, [id], 'qwen')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// ---------------------------------------------------------------- Gemini CLI

const gemini = (session_id, hook_event_name, more = {}) => [
  [],
  { session_id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, hook_event_name, timestamp: '2026-10-02T09:30:00.000Z', ...more },
]
const geminiTool = (id, event, tool_name, more = {}) =>
  gemini(id, event, {
    tool_name,
    tool_input: { command: PRIVATE.command, file_path: PRIVATE.file, content: PRIVATE.output },
    ...(event === 'AfterTool' ? { tool_response: { llmContent: `Exit Code: 1\n${PRIVATE.output}`, returnDisplay: PRIVATE.output } } : {}),
    ...more,
  })

await test('Gemini CLI: events become the two tags, and the outcomes it can tell', async () => {
  const m = await machine()
  const id = 'b1e2c3d4-0000-4a5b-8c9d-e0f1a2b3c4d5'
  const { trace, outputs } = await play(m, HOOK.gemini, [
    gemini(id, 'SessionStart', { source: 'startup' }),
    gemini(id, 'BeforeAgent', { prompt: `fix the failing refund test ${PRIVATE.words}` }),
    geminiTool(id, 'BeforeTool', 'run_shell_command'),
    gemini(id, 'Notification', { notification_type: 'ToolPermission', message: `Allow ${PRIVATE.command}?`, details: { type: 'exec', title: 'Confirm Shell Command', command: PRIVATE.command } }),
    // a command that ran and exited with an error is not marked as one: no outcome either way
    geminiTool(id, 'AfterTool', 'run_shell_command'),
    geminiTool(id, 'BeforeTool', 'replace'),
    // an edit that did not apply
    geminiTool(id, 'AfterTool', 'replace', { tool_response: { llmContent: PRIVATE.output, returnDisplay: PRIVATE.output, error: { type: 'edit_no_occurrence_found', message: PRIVATE.output } } }),
    geminiTool(id, 'BeforeTool', 'write_file'),
    geminiTool(id, 'AfterTool', 'write_file', { tool_response: { llmContent: 'ok', returnDisplay: 'ok' } }),
    geminiTool(id, 'BeforeTool', 'read_file'),
    geminiTool(id, 'AfterTool', 'read_file'),
    // a command that could not run at all
    geminiTool(id, 'AfterTool', 'run_shell_command', { tool_response: { llmContent: PRIVATE.output, returnDisplay: PRIVATE.output, error: { type: 'shell_execute_error', message: PRIVATE.output } } }),
    gemini(id, 'AfterModel', { llm_request: { model: 'gemini-3-pro', messages: [] }, llm_response: { candidates: [] } }),
    gemini(id, 'AfterAgent', { prompt: PRIVATE.words, prompt_response: PRIVATE.reply, stop_hook_active: false }),
    gemini(id, 'BeforeAgent', { prompt: 'ok' }),
    geminiTool(id, 'BeforeTool', 'ask_user'),
    gemini(id, 'SessionEnd', { reason: 'exit' }),
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'running/debug', 'waiting/debug', 'running/debug', '-', '-', '-', '-', '-', '-', '-', '-', 'idle/debug:x+x',
    'user/debug', 'waiting/debug', 'end',
  ])
  const said = JSON.parse(outputs[0]).systemMessage
  assert.match(said, /^escape\.fm is set up\. To open the player paired with this machine, run in your own terminal: node ".*open\.mjs"$/)
  assert.ok(outputs.slice(1).every((out) => out === ''), 'nothing else is printed, so Gemini CLI is never answered')
  checkPrivacy(m, [id], 'gemini')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// --------------------------------------------------------------- Copilot CLI

const copilot = (event, sessionId, more = {}) => [[event], { sessionId, timestamp: Date.now(), cwd: PRIVATE.cwd, ...more }]
const copilotTool = (event, id, toolName, more = {}) =>
  copilot(event, id, {
    toolName,
    // a JSON string, as the CLI's own example shows it
    toolArgs: JSON.stringify({ command: PRIVATE.command, path: PRIVATE.file }),
    ...(event === 'postToolUse' ? { toolResult: { resultType: 'success', textResultForLlm: PRIVATE.output } } : {}),
    ...(event === 'postToolUseFailure' ? { error: PRIVATE.output } : {}),
    ...more,
  })
const copilotNotice = (id, notification_type) =>
  copilot('notification', id, { hook_event_name: 'Notification', message: `Allow ${PRIVATE.command}?`, title: 'Permission needed', notification_type })

await test('Copilot CLI: events become the two tags, and the outcomes, and Copilot is never answered', async () => {
  const m = await machine()
  const id = '3f2e1d0c-aaaa-4bbb-8ccc-0123456789ab'
  const helper = '3f2e1d0c-bbbb-4bbb-8ccc-subagent0001'
  const { trace, outputs } = await play(m, HOOK.copilot, [
    copilot('sessionStart', id, { source: 'new', initialPrompt: PRIVATE.words }),
    // a tool under an id no message opened
    copilotTool('postToolUse', helper, 'bash'),
    copilot('userPromptSubmitted', id, { prompt: `why is the refund job crashing? ${PRIVATE.words}` }),
    copilotNotice(id, 'permission_prompt'),
    copilotTool('postToolUse', id, 'bash'),
    copilotTool('postToolUseFailure', id, 'bash'),
    copilotTool('postToolUse', id, 'view'),
    copilotNotice(id, 'shell_completed'),
    copilotTool('postToolUse', id, 'edit'),
    copilot('agentStop', id, { transcriptPath: PRIVATE.transcript, stopReason: 'end_turn', stop_hook_active: false }),
    copilot('userPromptSubmitted', id, { prompt: 'continue' }),
    copilotTool('postToolUse', id, 'edit'),
    copilotTool('postToolUse', id, 'create'),
    copilotNotice(id, 'elicitation_dialog'),
    copilot('sessionEnd', id, { reason: 'user_exit' }),
  ])
  assert.deepEqual(trace, [
    '-', '-', 'user/debug', 'waiting/debug', 'running/debug:+', '-', '-', '-', '-', 'idle/debug:x+',
    'user/debug', 'running/debug:+', 'running/deep:+', 'waiting/deep', 'end',
  ])
  assert.ok(outputs.every((out) => out === ''), 'nothing is printed, so no hook is ever answered for Copilot CLI')
  checkPrivacy(m, [id, helper], 'copilot')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

await test('Copilot CLI: no hook runs before a tool, where a hook that cannot start denies it', () => {
  const { hooks } = JSON.parse(readFileSync(path.join(ROOT, hooksFile('copilot')), 'utf8'))
  assert.ok(!('preToolUse' in hooks) && !('PreToolUse' in hooks) && !('permissionRequest' in hooks))
})

// --------------------------------------------------------------------- Droid

const droid = (session_id, hook_event_name, more = {}) => [
  [],
  { session_id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, permission_mode: 'auto-low', hook_event_name, ...more },
]
const droidTool = (id, event, tool_name, more = {}) =>
  droid(id, event, {
    tool_name,
    tool_input: { command: PRIVATE.command, file_path: PRIVATE.file },
    ...(event === 'PostToolUse' ? { tool_response: { stdout: PRIVATE.output, success: true } } : {}),
    ...more,
  })

await test('Droid: events become the two tags, and Droid is never answered', async () => {
  const m = await machine()
  const id = 'd401d000-1111-4222-8333-444455556666'
  const helper = 'd401d000-2222-4222-8333-subagent0001'
  const { trace, outputs } = await play(m, HOOK.droid, [
    droid(id, 'SessionStart', { source: 'startup' }),
    droidTool(helper, 'PreToolUse', 'Execute'),
    droid(id, 'UserPromptSubmit', { prompt: `fix the refund bug ${PRIVATE.words}`, has_images: false }),
    droidTool(id, 'PreToolUse', 'Execute'),
    droid(id, 'Notification', { notification_type: 'permission_prompt', message: `Droid needs your permission to run ${PRIVATE.command}` }),
    droidTool(id, 'PostToolUse', 'Execute'),
    droidTool(id, 'PreToolUse', 'Read'),
    droidTool(id, 'PostToolUse', 'Read'),
    // the listener stops the turn: Droid says so with this instead of Stop
    droid(id, 'Notification', { notification_type: 'idle_prompt', message: 'Droid is waiting for your input' }),
    droid(id, 'UserPromptSubmit', { prompt: 'go on', has_images: false, permission_mode: 'spec' }),
    droidTool(id, 'PreToolUse', 'AskUser'),
    droid(id, 'Stop', { stop_hook_active: false, tool_execution_count: 3, elapsed_time: 1200 }),
    droid(id, 'SubagentStop', { task_name: 'research', task_result: PRIVATE.reply, task_error: null, stop_hook_active: false }),
    droid(id, 'SessionEnd', { reason: 'other', session_duration_ms: 45000, message_count: 6 }),
  ])
  assert.deepEqual(trace, [
    'idle/null', '-', 'user/debug', 'running/debug', 'waiting/debug', 'running/debug', '-', '-', 'idle/debug',
    'user/plan', 'waiting/plan', 'idle/plan', '-', 'end',
  ])
  assert.ok(outputs.every((out) => out === ''), 'nothing is printed: at a session start Droid would hand it to the model')
  checkPrivacy(m, [id, helper], 'droid')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

// ------------------------------------------------- CodeBuddy Code and WorkBuddy

const buddy = (session_id, hook_event_name, more = {}) => [
  [],
  { session_id, transcript_path: PRIVATE.transcript, cwd: PRIVATE.cwd, permission_mode: 'default', hook_event_name, ...more },
]
const buddyTool = (id, event, tool_name, more = {}) =>
  buddy(id, event, {
    tool_name,
    tool_input: { file_path: PRIVATE.file, command: PRIVATE.command },
    ...(event === 'PostToolUse' ? { tool_response: { filePath: PRIVATE.file, success: true } } : {}),
    ...(event === 'PostToolUseFailure' ? { error: `Exit code 1\n${PRIVATE.output}`, is_interrupt: false } : {}),
    ...more,
  })

for (const tool of ['codebuddy', 'workbuddy']) {
  await test(`${tool === 'codebuddy' ? 'CodeBuddy Code' : 'WorkBuddy'}: events become the two tags, and the outcomes`, async () => {
    const m = await machine()
    const id = '6a1f3c9e-2b4d-4e8f-9a0c-1d2e3f4a5b6c'
    const { trace, outputs } = await play(m, HOOK[tool], [
      buddy(id, 'SessionStart', { source: 'startup', client: 'cli', version: '2.161.1', model: 'hunyuan' }),
      buddy(id, 'UserPromptSubmit', { prompt: `why does the refund test fail? ${PRIVATE.words}`, generation_id: 'gen-1' }),
      buddyTool(id, 'PreToolUse', 'Read'),
      buddyTool(id, 'PostToolUse', 'Read'),
      buddyTool(id, 'PreToolUse', 'Bash'),
      buddyTool(id, 'PermissionRequest', 'Bash'),
      buddy(id, 'Notification', { notification_type: 'permission_prompt', message: `CodeBuddy needs your permission to run ${PRIVATE.command}` }),
      buddyTool(id, 'PostToolUse', 'Bash'),
      // a compaction in the middle of a turn: the agent is not idle
      buddy(id, 'SessionStart', { source: 'compact' }),
      buddyTool(id, 'PreToolUse', 'Edit'),
      // an edit that did not apply: kept, and sent with the next report
      buddyTool(id, 'PostToolUseFailure', 'Edit'),
      // a search that found nothing is not the agent failing, nor is a tool the listener stopped
      buddyTool(id, 'PostToolUseFailure', 'Grep'),
      buddyTool(id, 'PostToolUseFailure', 'Bash', { is_interrupt: true }),
      buddyTool(id, 'PreToolUse', 'AskUserQuestion'),
      // waiting for input after a while is not a question
      buddy(id, 'Notification', { notification_type: 'idle_prompt', message: 'CodeBuddy is waiting for your input' }),
      buddy(id, 'Stop', { stop_hook_active: false, generation_id: 'gen-1', last_assistant_message: PRIVATE.reply, session_crons: [] }),
      buddy(id, 'UserPromptSubmit', { prompt: 'ok', permission_mode: 'plan' }),
      buddyTool(id, 'PreToolUse', 'Write'),
      buddyTool(id, 'PostToolUse', 'Write'),
      buddy(id, 'StopFailure', { error: 'rate_limit' }),
      buddy(id, 'PreCompact', { trigger: 'auto', custom_instructions: '' }),
      buddy(id, 'SessionEnd', { reason: 'prompt_input_exit' }),
    ])
    assert.deepEqual(trace, [
      'idle/null', 'user/debug', 'running/debug', '-', '-', 'waiting/debug', '-', 'running/debug:+', '-', '-', '-', '-', '-', 'waiting/debug:x',
      '-', 'idle/debug', 'user/plan', 'running/plan', '-', 'idle/plan:+', '-', 'end',
    ])
    const said = JSON.parse(outputs[0]).systemMessage
    assert.match(said, /^escape\.fm is set up\. To open the player paired with this machine, run in your own terminal: node ".*open\.mjs"$/)
    assert.ok(outputs.slice(1).every((out) => out === ''), 'nothing else is printed, so the agent is never answered')
    checkPrivacy(m, [id], tool)
    assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
    m.done()
  })
}

// ----------------------------------------------------------------- Muse Code

const muse = (session_id, hook_event_name, more = {}) => [
  [],
  { hook_event_name, session_id, turn_id: 'turn-1', cwd: PRIVATE.cwd, transcript_path: null, model: 'muse-1', permission_mode: 'default', ...more },
]
const museTool = (id, event, tool_name, more = {}) =>
  muse(id, event, {
    tool_name,
    tool_input: { command: PRIVATE.command, path: PRIVATE.file },
    ...(event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure' ? { tool_use_id: 'call_01' } : {}),
    ...(event === 'PostToolUse' ? { tool_response: PRIVATE.output } : {}),
    ...(event === 'PostToolUseFailure' ? { error: PRIVATE.output, is_interrupt: false, duration_ms: 812 } : {}),
    ...more,
  })

await test('Muse Code: events become the two tags, and the outcomes', async () => {
  const m = await machine()
  const id = '01a0ae0d-1cdf-7221-b5e5-96159c9a1ec0'
  const child = '01a0ae0d-2222-7221-b5e5-child0000001'
  const { trace, outputs } = await play(m, HOOK.muse, [
    [[], { hook_event_name: 'SessionStart', source: 'startup', session_id: id, cwd: PRIVATE.cwd, transcript_path: null, model: 'unknown', permission_mode: 'default' }],
    muse(id, 'UserPromptSubmit', { prompt: `why does the refund test fail? ${PRIVATE.words}` }),
    museTool(id, 'PreToolUse', 'bash'),
    museTool(id, 'PermissionRequest', 'bash'),
    muse(id, 'Notification', { notification_type: 'permission_prompt', title: 'Approval needed', message: `Run ${PRIVATE.command}?` }),
    museTool(id, 'PostToolUse', 'bash'),
    // a child agent's tools, under a session of its own that no message opened
    museTool(child, 'PreToolUse', 'read_file'),
    muse(child, 'StopFailure', { error: 'model_error', agent_id: 'agent-1', agent_type: 'explorer' }),
    museTool(id, 'PreToolUse', 'edit_file'),
    museTool(id, 'PostToolUseFailure', 'edit_file'),
    museTool(id, 'PreToolUse', 'search'),
    museTool(id, 'PostToolUseFailure', 'search'),
    museTool(id, 'PostToolBatch', 'edit_file', { tool_calls: [] }),
    museTool(id, 'PreToolUse', 'request_user_input'),
    muse(id, 'PreLLMCall', { provider: 'meta', messages: [{ preview: PRIVATE.reply }] }),
    muse(id, 'Stop', { stop_hook_active: false, last_assistant_message: PRIVATE.reply }),
    muse(id, 'SessionStart', { source: 'compact' }),
    muse(id, 'UserPromptSubmit', { prompt: 'ok', permission_mode: 'plan' }),
    museTool(id, 'PreToolUse', 'write_file'),
    museTool(id, 'PostToolUse', 'write_file'),
    muse(id, 'StopFailure', { error: 'rate_limit', error_details: PRIVATE.output }),
    [[], { hook_event_name: 'SessionEnd', session_id: id, cwd: PRIVATE.cwd, transcript_path: null, model: 'unknown', permission_mode: 'default', reason: 'exit' }],
  ])
  assert.deepEqual(trace, [
    'idle/null', 'user/debug', 'running/debug', 'waiting/debug', '-', 'running/debug:+', '-', '-', '-', '-', '-', '-', '-', 'waiting/debug:x',
    '-', 'idle/debug', '-', 'user/plan', 'running/plan', '-', 'idle/plan:+', 'end',
  ])
  const said = JSON.parse(outputs[0]).systemMessage
  assert.match(said, /^escape\.fm is set up\. To open the player paired with this machine, run in your own terminal: node ".*open\.mjs"$/)
  assert.ok(said.length <= 1000, 'Muse Code takes a systemMessage of 1000 characters at most')
  assert.ok(outputs.slice(1).every((out) => out === ''), 'nothing else is printed, so Muse Code is never answered')
  checkPrivacy(m, [id, child], 'muse')
  assert.deepEqual(allFiles(path.join(m.fm, 'sessions')), [])
  m.done()
})

await test('Muse Code: every handler has only fields its settings accept, and runs in the background but at a start and an end', () => {
  const { hooks } = JSON.parse(readFileSync(path.join(ROOT, hooksFile('muse')), 'utf8'))
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      // a matcher of letters, digits, _ and | is a list of exact names
      if ('matcher' in group) assert.match(group.matcher, /^[A-Za-z0-9_|]+$/, event)
      for (const handler of group.hooks) {
        assert.deepEqual(Object.keys(handler).filter((key) => !['type', 'command', 'timeout', 'async'].includes(key)), [], `${event}: a field Muse Code would skip the handler for`)
        assert.ok(Number.isInteger(handler.timeout), `${event}: a timeout in whole seconds`)
        assert.equal(handler.async === true, !['SessionStart', 'Stop', 'StopFailure', 'SessionEnd'].includes(event), event)
      }
    }
  }
})

// ------------------------------------------------------------------ OpenClaw

/** A stand-in for the API OpenClaw gives a plugin: its typed hooks and its agent event stream, fired by hand. */
function openclawApi() {
  const hooks = new Map()
  const streams = []
  return {
    api: {
      id: 'escape-fm',
      config: { channels: { telegram: { botToken: PRIVATE.output } } },
      on: (name, handler) => hooks.set(name, [...(hooks.get(name) ?? []), handler]),
      runtime: { events: { onAgentEvent: (listener) => (streams.push(listener), () => {}) } },
    },
    hook: (name, event, ctx = {}) => {
      for (const handler of hooks.get(name) ?? []) assert.equal(handler(event, ctx), undefined, `${name} answers nothing`)
    },
    stream: (event) => streams.forEach((listener) => listener(event)),
    hooks,
  }
}

await test('OpenClaw: the plugin passes on only the conversation, the event, a tool and whether it failed', async () => {
  const { listen } = await import(path.join(ROOT, 'integrations/openclaw/index.js'))
  const { api, hook, stream, hooks } = openclawApi()
  const sent = []
  listen(api, (event) => sent.push(event))
  assert.deepEqual([...hooks.keys()].sort(), ['after_tool_call', 'before_tool_call', 'gateway_start', 'message_received', 'session_end'], 'no hook that hands over the conversation, or can change anything but a tool call, which it never does')

  const key = 'agent:main:telegram:direct:12345678'
  const group = 'agent:main:telegram:group:-100987654'
  const message = { from: 'telegram:12345678', content: `fix the refund test ${PRIVATE.words}`, metadata: { senderName: PRIVATE.email } }
  hook('gateway_start', { port: 18789 }, { port: 18789 })
  hook('message_received', { ...message, sessionKey: key, runId: 'run-1' }, { channelId: 'telegram', sessionKey: key })
  stream({ runId: 'run-1', seq: 1, stream: 'lifecycle', ts: 1, sessionKey: key, data: { phase: 'start', startedAt: 1 } })
  hook('before_tool_call', { toolName: 'exec', params: { command: PRIVATE.command }, runId: 'run-1', toolCallId: 't1' }, { sessionKey: key, runId: 'run-1', toolName: 'exec' })
  // a run that is not shown in the Control UI: its events after the start come without the key
  stream({ runId: 'run-1', seq: 2, stream: 'lifecycle', ts: 2, data: { phase: 'waiting-approval', approvalId: 'ap-1' } })
  stream({ runId: 'run-1', seq: 3, stream: 'execution', ts: 3, data: { approval: { id: 'ap-1', state: 'pending' } } })
  stream({ runId: 'run-1', seq: 4, stream: 'lifecycle', ts: 4, data: { phase: 'approval-resolved', approvalId: 'ap-1' } })
  hook('after_tool_call', { toolName: 'exec', params: { command: PRIVATE.command }, runId: 'run-1', result: { content: PRIVATE.output }, durationMs: 40 }, { sessionKey: key, runId: 'run-1' })
  hook('before_tool_call', { toolName: 'edit', params: { path: PRIVATE.file }, runId: 'run-1' }, { sessionKey: key, runId: 'run-1' })
  hook('after_tool_call', { toolName: 'edit', params: { path: PRIVATE.file }, runId: 'run-1', error: PRIVATE.output }, { sessionKey: key, runId: 'run-1' })
  stream({ runId: 'run-1', seq: 5, stream: 'assistant', ts: 5, sessionKey: key, data: { text: PRIVATE.reply } })
  stream({ runId: 'run-1', seq: 6, stream: 'lifecycle', ts: 6, sessionKey: key, data: { phase: 'end' } })
  // someone else in a group: the agent works, but nobody here typed
  hook('message_received', { ...message, sessionKey: group }, { channelId: 'telegram', sessionKey: group })
  stream({ runId: 'run-2', seq: 1, stream: 'lifecycle', ts: 7, sessionKey: group, data: { phase: 'start' } })
  stream({ runId: 'run-2', seq: 2, stream: 'lifecycle', ts: 8, sessionKey: group, data: { phase: 'error', error: PRIVATE.output } })
  // the agent's own heartbeat is not work anyone asked for
  stream({ runId: 'run-3', seq: 1, stream: 'lifecycle', ts: 9, sessionKey: key, isHeartbeat: true, data: { phase: 'start' } })
  // OpenClaw 2026.3: a command waiting for approval returns at once, and the run ends while it waits
  stream({ runId: 'run-4', seq: 1, stream: 'lifecycle', ts: 10, sessionKey: key, data: { phase: 'start' } })
  hook('after_tool_call', { toolName: 'exec', runId: 'run-4', result: { details: { status: 'approval-pending', approvalId: 'ap-2', command: PRIVATE.command } } }, { sessionKey: key })
  stream({ runId: 'run-4', seq: 2, stream: 'lifecycle', ts: 11, sessionKey: key, data: { phase: 'end' } })
  hook('session_end', { sessionId: 'uuid-1', sessionKey: key, messageCount: 4 }, { sessionId: 'uuid-1', sessionKey: key })
  // a hook given something unexpected stays quiet
  hook('after_tool_call', null, null)
  stream(null)

  assert.deepEqual(
    sent.map((event) => [event.session_id === key ? 'dm' : event.session_id === group ? 'group' : '-', event.hook_event_name, event.tool_name ?? '', event.failed ?? ''].join(' ').trim()),
    [
      '- gateway_start',
      'dm message_received',
      'dm run_start',
      'dm tool_start exec',
      'dm approval_requested',
      'dm approval_resolved',
      'dm tool_end exec false',
      'dm tool_start edit',
      'dm tool_end edit true',
      'dm run_end',
      'group run_start',
      'group run_end',
      'dm run_start',
      'dm approval_requested',
      'dm session_end',
    ],
  )
  const wire = JSON.stringify(sent)
  for (const secret of SECRETS) assert.ok(!wire.includes(secret), `passed on: ${secret}`)

  // and what scripts/hook.mjs makes of them
  const m = await machine()
  const { trace, outputs } = await play(m, HOOK.openclaw, sent.map((event) => [[], event]))
  assert.deepEqual(trace, [
    '-', 'user/deep', 'running/deep', '-', 'waiting/deep', 'running/deep', '-', '-', '-', 'idle/deep:+x', 'running/null', 'idle/null', 'running/deep', 'waiting/deep', 'end',
  ])
  assert.ok(outputs.every((out) => out === ''), 'nothing is printed')
  checkPrivacy(m, [key, group], 'openclaw')
  m.done()
})

await test('OpenClaw: the plugin hands each event to the hook script on a process of its own', async () => {
  const { listen } = await import(path.join(ROOT, 'integrations/openclaw/index.js'))
  const m = await machine()
  const saved = { ...process.env }
  Object.assign(process.env, { ESCAPE_FM_HOME: m.env.ESCAPE_FM_HOME, ESCAPE_FM_API: m.env.ESCAPE_FM_API, ESCAPE_FM_NO_OPEN: '1', NO_PROXY: '127.0.0.1' })
  try {
    const { api, hook, stream } = openclawApi()
    listen(api)
    const key = 'agent:main:main'
    hook('message_received', { from: 'webchat', content: PRIVATE.words, sessionKey: key }, { channelId: 'webchat', sessionKey: key })
    stream({ runId: 'r', seq: 1, stream: 'lifecycle', ts: 1, sessionKey: key, data: { phase: 'start' } })
    stream({ runId: 'r', seq: 2, stream: 'lifecycle', ts: 2, sessionKey: key, data: { phase: 'end' } })
    hook('session_end', { sessionId: 'u', sessionKey: key, messageCount: 2 }, { sessionKey: key })
    await m.server.settle(4)
  } finally {
    for (const name of ['ESCAPE_FM_HOME', 'ESCAPE_FM_API', 'ESCAPE_FM_NO_OPEN', 'NO_PROXY']) {
      if (name in saved) process.env[name] = saved[name]
      else delete process.env[name]
    }
  }
  const bodies = m.server.seen.map((request) => JSON.parse(request.body))
  // each report goes out on a process of its own, so they may arrive in any order; each says what the state was when it went
  assert.deepEqual(bodies.map((body) => (body.end ? 'end' : body.agent)).sort(), ['end', 'idle', 'running', 'user'])
  checkPrivacy(m, ['agent:main:main'], 'openclaw')
  m.done()
})

await test('OpenClaw: install.mjs copies the plugin and links it with the openclaw command, and takes it out again', async () => {
  const m = await machine()
  // a stand-in openclaw that notes how it was called
  const bin = path.join(m.home, 'bin')
  const calls = path.join(m.home, 'calls.txt')
  mkdirSync(bin)
  writeFileSync(path.join(bin, 'openclaw'), `#!/bin/sh\necho "$*" >> "${calls}"\n`, { mode: 0o755 })
  const env = { ...m.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` }
  const install = path.join(ROOT, 'integrations/openclaw/install.mjs')
  const dest = path.join(m.fm, 'openclaw')
  for (const round of [1, 2]) {
    const result = await run(install, [], '', env)
    assert.equal(result.code, 0, result.err)
    assert.match(result.out, /openclaw gateway restart/)
    for (const name of ['index.js', 'openclaw.plugin.json', 'package.json', 'scripts/hook.mjs', 'scripts/session.mjs', 'scripts/client.mjs']) {
      assert.ok(existsSync(path.join(dest, name)), `round ${round}: ${name}`)
    }
    assert.ok(!existsSync(path.join(dest, 'install.mjs')))
  }
  // the installed copy works from where it was put
  await run(path.join(dest, 'scripts/hook.mjs'), [], { session_id: 's-1', hook_event_name: 'message_received' }, env)
  await m.server.settle(1)
  assert.equal(JSON.parse(m.server.seen[0].body).agent, 'user')
  assert.equal(m.server.seen[0].headers['user-agent'], userAgent('openclaw'))
  const removed = await run(install, ['--uninstall'], '', env)
  assert.equal(removed.code, 0, removed.err)
  assert.ok(!existsSync(dest), 'the plugin is gone')
  assert.ok(existsSync(path.join(m.fm, 'config.json')), 'the pairing is kept')
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
    `plugins install --link ${dest}`,
    `plugins install --link ${dest}`,
    'plugins uninstall escape-fm --force',
  ])
  // with no openclaw at all, it says what to run
  const bare = await run(install, [], '', { ...m.env, PATH: path.join(m.home, 'no-bin') })
  assert.equal(bare.code, 0, bare.err)
  assert.match(bare.out, /There is no openclaw command here\. Where OpenClaw is installed, run: openclaw plugins install --link /)
  m.done()
})

await test('OpenClaw: the manifest and package.json agree, and the plugin loads as OpenClaw loads it', async () => {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'integrations/openclaw/openclaw.plugin.json'), 'utf8'))
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'integrations/openclaw/package.json'), 'utf8'))
  assert.equal(pkg.version, manifest.version)
  assert.equal(pkg.name, manifest.id, 'OpenClaw warns when the package name and the id differ')
  assert.deepEqual(pkg.openclaw.extensions, ['./index.js'])
  assert.deepEqual(manifest.activation, { onStartup: true }, 'newer versions load a plugin with hooks at start only when asked to')
  const plugin = (await import(path.join(ROOT, 'integrations/openclaw/index.js'))).default
  assert.equal(plugin.id, manifest.id)
  assert.equal(typeof plugin.register, 'function')
})

// ------------------------------------------------------------ the agents alike

const first = {
  claude: claude('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  codex: codex('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  cursor: cursor('beforeSubmitPrompt', 's-1', { prompt: 'fix the bug' }),
  qwen: qwen('s-1', 'UserPromptSubmit', { prompt: 'fix the bug', submitted_prompt: 'fix the bug' }),
  gemini: gemini('s-1', 'BeforeAgent', { prompt: 'fix the bug' }),
  copilot: copilot('userPromptSubmitted', 's-1', { prompt: 'fix the bug' }),
  droid: droid('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  codebuddy: buddy('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  workbuddy: buddy('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  muse: muse('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' }),
  openclaw: [[], { session_id: 's-1', hook_event_name: 'message_received' }],
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

  // OpenClaw has no hooks.json: its plugin calls the script (above)
  if (name !== 'openclaw') await test(`${name}: every event in its hooks.json runs this script`, () => {
    const hooks = eventsIn(JSON.parse(readFileSync(path.join(ROOT, hooksFile(name)), 'utf8')))
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

// ------------------------------------------------------------ the computer's name

await test("ESCAPE_FM_COMPUTER_NAME is the name every report but the last carries", async () => {
  const m = await machine()
  const env = { ...m.env, ESCAPE_FM_COMPUTER_NAME: "  Ada's\u200b MacBook\tPro  " }
  const id = 'feedface-0000-4000-8000-000000000002'
  const { trace } = await play({ ...m, env }, HOOK.cursor, [
    cursor('beforeSubmitPrompt', id, { prompt: 'fix the bug' }),
    cursorTool('preToolUse', id, 'Shell'),
    cursor('sessionEnd', id, { session_id: id, reason: 'completed' }),
  ])
  assert.deepEqual(trace, ['user/debug', 'running/debug', 'end'])
  const bodies = m.server.seen.map((request) => JSON.parse(request.body))
  assert.deepEqual(bodies.map((body) => body.computer), ["Ada's MacBook Pro", "Ada's MacBook Pro", undefined])
  checkPrivacy(m, [id], 'cursor')
  assert.ok(!existsSync(path.join(m.fm, 'computer.json')), 'a name given is not looked up, or kept')
  m.done()
})

await test('ESCAPE_FM_COMPUTER_NAME set to nothing sends no name', async () => {
  const m = await machine()
  const env = { ...m.env, ESCAPE_FM_COMPUTER_NAME: '' }
  await play({ ...m, env }, HOOK.claude, [claude('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' })])
  assert.equal(Object.keys(JSON.parse(m.server.seen[0].body)).sort().join(','), 'agent,mode,session,ts')
  checkPrivacy(m, [], 'claude')
  m.done()
})

await test("the computer's name is looked up once a day and kept in a file of its own", async () => {
  const m = await machine()
  mkdirSync(m.fm, { recursive: true })
  const cache = path.join(m.fm, 'computer.json')
  writeFileSync(cache, JSON.stringify({ name: 'Kept Name', at: Date.now() - 60_000 }) + '\n')
  await play(m, HOOK.codex, [codex('s-1', 'UserPromptSubmit', { prompt: 'fix the bug' })])
  assert.equal(JSON.parse(m.server.seen[0].body).computer, 'Kept Name', 'a name looked up today is used as it is')
  // a day old: asked again, and whatever the system says now is kept with the time
  writeFileSync(cache, JSON.stringify({ name: 'Kept Name', at: Date.now() - 25 * 60 * 60 * 1000 }) + '\n')
  await play(m, HOOK.codex, [codex('s-1', 'UserPromptSubmit', { prompt: 'and the other one' })])
  const kept = JSON.parse(readFileSync(cache, 'utf8'))
  assert.ok(Date.now() - kept.at < 60_000, 'looked up again')
  assert.ok(kept.name === null || (typeof kept.name === 'string' && kept.name !== 'Kept Name'))
  assert.equal(JSON.parse(m.server.seen[1].body).computer, kept.name ?? undefined)
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(path.join(m.fm, 'config.json'), 'utf8'))), ['key', 'unopened'], 'nothing of it in config.json')
  checkPrivacy(m, [], 'codex')
  m.done()
})

await test('a host name is made readable, and one that says nothing is not sent', async () => {
  // the copy, not shared/: lib.mjs, which it needs, imports the client.mjs only the copies have
  const { prettify, clean } = await import(path.join(ROOT, 'plugin/scripts/computer.mjs'))
  const cases = {
    'DESKTOP-AB12CD': 'Desktop AB12CD',
    'ada-thinkpad': 'Ada Thinkpad',
    'ada-thinkpad.local': 'Ada Thinkpad',
    'ADA_PC.lan': 'Ada PC',
    'Adas-MacBook-Pro.local': 'Adas MacBook Pro',
    'build box': 'Build Box',
    localhost: null,
    'LOCALHOST.localdomain': null,
    'ip-172-31-5-10': null,
    'ip-172-31-5-10.ec2.internal': null,
    '10.0.0.5': null,
    'fe80::1': null,
    '3f4a9c2b1d7e': null,
    '0b8d1c3e-6f2a-4d5b-9c7e-1a2b3c4d5e6f': null,
    '1234': null,
    '': null,
    '   ': null,
  }
  for (const [host, want] of Object.entries(cases)) assert.equal(prettify(host), want, host)
  assert.equal(prettify(undefined), null)
  assert.equal(prettify('a'.repeat(60)), 'A' + 'a'.repeat(39))
  assert.equal(clean(' Ada\u0000\u202e  Mac\n'), 'Ada Mac')
  assert.equal(clean('\u200b'), null)
  assert.equal([...clean('🎧'.repeat(50))].length, 40)
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

/** For each installer: the file it writes the hooks into, and what is in it already, which must stay. */
const others = {
  codex: { file: 'hooks.json', config: { hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'python3 ~/.codex/hooks/policy.py' }] }] } } },
  cursor: { file: 'hooks.json', config: { version: 1, hooks: { afterFileEdit: [{ command: './hooks/format.sh' }], stop: [{ command: './hooks/audit.sh', loop_limit: 10 }] } } },
  qwen: {
    file: 'settings.json',
    config: {
      model: { name: 'qwen3-coder-plus' },
      disableAllHooks: false,
      hooks: { PreToolUse: [{ matcher: '^run_shell_command$', hooks: [{ type: 'command', command: '/path/to/security-check.sh', name: 'security-check', timeout: 30 }] }] },
    },
  },
  gemini: {
    file: 'settings.json',
    config: {
      ui: { theme: 'GitHub' },
      hooksConfig: { enabled: true },
      hooks: { BeforeTool: [{ matcher: 'write_file|replace', hooks: [{ name: 'security-check', type: 'command', command: '$GEMINI_PROJECT_DIR/.gemini/hooks/security.sh', timeout: 5000 }] }] },
    },
  },
  codebuddy: {
    file: 'settings.json',
    config: {
      model: 'claude-4.5',
      permissions: { allow: ['Bash(npm run lint)'] },
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: "jq -r '.tool_input.command' >> ~/.codebuddy/bash-command.log" }] }] },
    },
  },
  workbuddy: {
    file: 'settings.json',
    config: {
      enabledPlugins: { 'pet@workbuddy-buddy': true },
      hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: '/path/to/your-hook.sh UserPromptSubmit' }] }] },
    },
  },
  muse: {
    file: 'settings.json',
    config: {
      schema_version: 1,
      model: 'muse-1',
      hooks: { PreToolUse: [{ matcher: 'bash', hooks: [{ type: 'command', command: '~/.config/muse/hooks/guard.sh', timeout: 10 }] }] },
    },
  },
  droid: {
    file: 'hooks.json',
    config: { PreToolUse: [{ matcher: 'Execute', commandRegex: '^git ', hooks: [{ type: 'command', command: '/usr/local/bin/audit-git-command.sh', timeout: 30 }] }] },
  },
}

for (const tool of ['codex', 'cursor', 'qwen', 'gemini', 'droid', 'codebuddy', 'workbuddy', 'muse']) {
  await test(`${tool}: install.mjs adds the hooks beside what is there, and takes out only its own`, async () => {
    const m = await machine()
    const dir = path.join(m.home, `dot-${tool}`)
    const file = path.join(dir, others[tool].file)
    const install = path.join(ROOT, `integrations/${tool}/install.mjs`)
    const env = { ...m.env, CODEX_HOME: path.join(m.home, 'not-used'), CODEBUDDY_CONFIG_DIR: path.join(m.home, 'not-used'), WORKBUDDY_CONFIG_DIR: path.join(m.home, 'not-used'), XDG_CONFIG_HOME: path.join(m.home, 'not-used') }

    const missing = await run(install, ['--dir', dir], '', env)
    assert.equal(missing.code, 1, 'refuses a folder that is not there')
    assert.ok(!existsSync(dir))

    mkdirSync(dir)
    writeFileSync(file, JSON.stringify(others[tool].config, null, 2) + '\n')
    const printed = await run(install, ['--dir', dir, '--print'], '', env)
    assert.equal(printed.code, 0)
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), others[tool].config, '--print writes nothing to the file')

    for (const round of [1, 2]) {
      const result = await run(install, ['--dir', dir], '', env)
      assert.equal(result.code, 0, result.err)
      const config = JSON.parse(readFileSync(file, 'utf8'))
      const script = path.join(m.fm, tool, 'hook.mjs')
      const commands = Object.values(eventsIn(config)).flat().flatMap((item) => item.hooks ?? [item]).map((handler) => handler.command)
      const ours = commands.filter((command) => command.includes(script))
      const template = eventsIn(JSON.parse(readFileSync(path.join(ROOT, hooksFile(tool)), 'utf8')))
      assert.equal(ours.length, Object.keys(template).length, `round ${round}: one handler an event, not doubled by installing again`)
      assert.ok(ours.every((command) => command.startsWith(`node "${script}"`)), 'the hooks run the installed copy by its full path')
      for (const [event, list] of Object.entries(eventsIn(others[tool].config))) assert.deepEqual(eventsIn(config)[event].slice(0, list.length), list, 'what was there is kept, first')
      for (const [key, value] of Object.entries(others[tool].config)) if (key !== 'hooks' && eventsIn(others[tool].config) !== others[tool].config) assert.deepEqual(config[key], value, 'the other settings are kept')
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
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), others[tool].config, 'the file is as it was')
    assert.ok(!existsSync(path.join(m.fm, tool)), 'the scripts are gone')
    assert.ok(existsSync(path.join(m.fm, 'config.json')), 'the pairing is kept')
    m.done()
  })
}

await test('copilot: install.mjs writes a hook file of its own, and takes only that out', async () => {
  const m = await machine()
  const dir = path.join(m.home, 'dot-copilot', 'hooks')
  const theirs = path.join(dir, 'audit.json')
  const mine = { version: 1, hooks: { preToolUse: [{ type: 'command', bash: './scripts/audit.sh', timeoutSec: 10 }] } }
  mkdirSync(dir, { recursive: true })
  writeFileSync(theirs, JSON.stringify(mine, null, 2) + '\n')
  const install = path.join(ROOT, 'integrations/copilot/install.mjs')
  const env = { ...m.env, COPILOT_HOME: path.join(m.home, 'not-used') }
  for (const round of [1, 2]) {
    const result = await run(install, ['--dir', dir], '', env)
    assert.equal(result.code, 0, result.err)
    const config = JSON.parse(readFileSync(path.join(dir, 'escape-fm.json'), 'utf8'))
    assert.equal(config.version, 1)
    const script = path.join(m.fm, 'copilot', 'hook.mjs')
    const commands = Object.values(config.hooks).flat().map((handler) => handler.command)
    assert.equal(commands.length, 7, `round ${round}: one handler an event`)
    assert.ok(commands.every((command) => command.startsWith(`node "${script}" `)), 'the installed copy, by its full path, with the event named')
    assert.ok(!('preToolUse' in config.hooks))
  }
  const [args, input] = first.copilot
  await run(path.join(m.fm, 'copilot', 'hook.mjs'), args, input, env)
  await m.server.settle(1)
  assert.equal(JSON.parse(m.server.seen[0].body).agent, 'user')
  assert.equal(m.server.seen[0].headers['user-agent'], userAgent('copilot'))
  const removed = await run(install, ['--dir', dir, '--uninstall'], '', env)
  assert.equal(removed.code, 0, removed.err)
  assert.ok(!existsSync(path.join(dir, 'escape-fm.json')), 'the hook file is gone')
  assert.deepEqual(JSON.parse(readFileSync(theirs, 'utf8')), mine, 'the other hook files are as they were')
  assert.ok(!existsSync(path.join(m.fm, 'copilot')))
  m.done()
})

await test('droid: install.mjs adds to settings.json where the hooks are kept there, not to a hooks.json that would hide them', async () => {
  const m = await machine()
  const dir = path.join(m.home, 'dot-factory')
  const settings = { model: 'claude-opus-4-7', hooks: { Stop: [{ hooks: [{ type: 'command', command: '/usr/local/bin/notify.sh' }] }] } }
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n')
  const install = path.join(ROOT, 'integrations/droid/install.mjs')
  const result = await run(install, ['--dir', dir], '', m.env)
  assert.equal(result.code, 0, result.err)
  assert.ok(!existsSync(path.join(dir, 'hooks.json')), 'no hooks.json')
  const config = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'))
  assert.equal(config.model, settings.model)
  assert.deepEqual(config.hooks.Stop[0], settings.hooks.Stop[0])
  assert.equal(Object.keys(config.hooks).length, 7)
  const removed = await run(install, ['--dir', dir, '--uninstall'], '', m.env)
  assert.equal(removed.code, 0, removed.err)
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8')), settings)
  m.done()
})

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

/**
 * The guide an agent reads to install escape.fm (public/install-plugin.md, served at escape.fm/install-plugin.md):
 * every integration is in it with the command that installs it, and the version it names is the one released.
 */
await test('the install guide has every integration, with its command, and the version every manifest has', () => {
  // in the public repository it is at the root (scripts/publish-plugins.mjs)
  const where = ['public/install-plugin.md', 'install-plugin.md'].map((name) => path.join(ROOT, name)).find((file) => existsSync(file))
  assert.ok(where, 'the guide is there')
  const guide = readFileSync(where, 'utf8')
  const command = (tool) =>
    ({
      claude: 'claude plugin install escape-fm@escape-fm',
      codex: 'codex plugin add escape-fm@escape-fm',
      gemini: 'gemini extensions install ~/.escape-fm/plugins/integrations/gemini',
    })[tool] ?? `node ~/.escape-fm/plugins/integrations/${tool}/install.mjs`
  const tools = ['claude', ...readdirSync(path.join(ROOT, 'integrations'))]
  for (const tool of tools) {
    assert.ok(tool in HOOK, `integrations/${tool} is tested here`)
    assert.ok(guide.includes(command(tool)), `the guide installs ${tool} with: ${command(tool)}`)
  }
  const versions = new Set(Object.values(CLIENT).map(({ manifest }) => JSON.parse(readFileSync(path.join(ROOT, manifest), 'utf8')).version))
  assert.equal(versions.size, 1, `one version for every integration: ${[...versions].join(', ')}`)
  const named = [...guide.matchAll(/plugins (\d+\.\d+\.\d+)/g)].map((found) => found[1])
  assert.ok(named.length > 0 && named.every((version) => versions.has(version)), `the guide names ${named.join(', ')}`)
})

await test('the copies of shared/ are in sync', async () => {
  const result = await run(path.join(ROOT, 'scripts/sync-integrations.mjs'), ['--check'], '', { PATH: process.env.PATH })
  assert.equal(result.code, 0, result.err)
})

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
