// Decides the work mode from the prompt, locally. The prompt is read here and
// goes no further: only the resulting tag is ever sent.
//
// This is a keyword heuristic, deliberately simple and easy to read. A prompt
// that matches nothing keeps the mode the session already had.

/** Listed in priority order: on a tie the earlier mode wins. */
const RULES = [
  ['debug', [
    /\b(bugs?|errors?|exceptions?|crash(es|ed|ing)?|fail(s|ed|ing|ures?)?|traceback|stack ?trace|broken|not working|doesn'?t work|debug(ging)?|fix(es|ed|ing)?|regression|flaky|why (is|does|did|isn'?t|doesn'?t))\b/gi,
    /报错|错误|异常|崩溃|失败|修复|修一下|排查|调试|出问题|有问题|不工作|不生效|不对|为什么|怎么回事|挂了/g,
  ]],
  ['plan', [
    /\b(plan(ning)?|roadmap|strategy|trade-?offs?|prioriti[sz]e|milestones?|architecture|design doc|proposal|should we|how should|retro(spective)?)\b/gi,
    /计划|规划|方案|排期|路线图|取舍|复盘|架构|怎么设计|怎么处理|要不要|是不是要|下一步/g,
  ]],
  ['polish', [
    /\b(review|proofread|polish|refactor(ing)?|clean ?up|simplif(y|ied)|reword|rephrase|tidy|lint|nit(s|picks?)?)\b/gi,
    /审阅|审查|检查一下|润色|校对|改稿|措辞|重构|精简|打磨|优化一下/g,
  ]],
  ['analyze', [
    /\b(analy[sz](e|is|ing)|statistics?|metrics?|spreadsheet|csv|calculat(e|ion)|sql|quer(y|ies)|benchmark|profil(e|ing)|forecast|model(ling|ing)?)\b/gi,
    /分析|统计|数据|指标|表格|计算|报表|财务|测算|换算|对账/g,
  ]],
  ['ideate', [
    /\b(brainstorm(ing)?|ideas?|naming|name for|names? (for|of)|slogans?|taglines?|concepts?|what if|creative)\b/gi,
    /头脑风暴|起名|名字|文案|创意|点子|想法|灵感|玩法|脑洞/g,
  ]],
  ['explore', [
    /\b(research|explain|what is|what are|how does|how do|compare|comparison|look ?up|find out|docs?|documentation|learn|understand|investigate|survey)\b/gi,
    /调研|研究|了解|是什么|怎么用|对比|比较|查一下|查查|搜一下|文档|看看|梳理/g,
  ]],
  ['routine', [
    /\b(commit|push|merge|rebase|rename|bump|upgrade|update (the )?dep(s|endencies)|changelog|release notes|format(ting)?|email|reply|translate|deploy|publish)\b/gi,
    /提交|重命名|批量|格式|升级依赖|邮件|回复|填表|整理|翻译|部署|发布/g,
  ]],
  ['deep', [
    /\b(implement|build|create|write|add (a |an |the )?\w+|develop|make (a|an)|scaffold|prototype|draft)\b/gi,
    /实现|写一个|写个|开发|新增|添加|做一个|做个|搭|开始做|起草|生成/g,
  ]],
]

/** @returns {string | null} a work mode, or null when the prompt gives no hint */
export function classify(prompt, permissionMode) {
  const text = String(prompt ?? '').slice(0, 4000)
  let best = null
  let bestScore = 0
  for (const [mode, patterns] of RULES) {
    let score = 0
    for (const pattern of patterns) score += (text.match(pattern) ?? []).length
    if (mode === 'plan' && permissionMode === 'plan') score += 2
    if (score > bestScore) {
      best = mode
      bestScore = score
    }
  }
  return best
}

/**
 * When the prompt said nothing, what the agent then does is a hint:
 * mostly editing is building, only reading is exploring. Each agent names its
 * tools differently, so its hook script says which of its tools edit and which read.
 * @param {string[]} tools what kind each tool used since the last prompt was: 'edit', 'read', 'ask' or 'other'
 */
export function fromTools(tools) {
  const edits = tools.filter((t) => t === 'edit').length
  const reads = tools.filter((t) => t === 'read').length
  if (edits >= 2) return 'deep'
  if (reads >= 4 && edits === 0) return 'explore'
  return null
}

/**
 * Test runners, as the start of one command in a shell command line. Like RULES, a list to read
 * rather than a parser: a test run that is not here is counted as a command, which is no harm.
 */
const TESTS = [
  /^(npm|pnpm|yarn|bun)( (--?[\w-]+(=\S+)?|--filter \S+|-F \S+|workspace \S+|--prefix \S+))* (run )?(test|t)(\s|:|$)/,
  /^(npx|bunx|pnpm( exec| dlx)?|yarn( exec| dlx)?|bun( x)?) (jest|vitest|mocha|playwright test)\b/,
  /^((\.\/)?node_modules\/\.bin\/)?(jest|vitest|mocha)\b/,
  /^((uv|poetry|pipenv|pdm|hatch) run )?(pytest|py\.test|python[\d.]* -m (pytest|unittest))\b/,
  /^go test\b/,
  /^cargo( \+\S+)? (test|nextest)\b/,
  /^swift test\b/,
  /^xcodebuild\b.*\s(test|test-without-building)(\s|$)/,
  /^(\.\/)?mvnw?\b.*\s(test|verify)(\s|$)/,
  /^(\.\/)?gradlew?\b.*\s(\S+:)?test(\s|$)/,
  /^(bundle exec )?(bin\/)?(rspec|rake (test|spec)|rails test)\b/,
  /^((\.\/)?vendor\/bin\/)?phpunit\b/,
  /^dotnet test\b/,
  /^make\b.*\s(test|check)(\s|$)/,
  /^(ctest|tox|nox)\b/,
  /^node( --[\w-]+(=\S+)?)* --test\b/,
  /^deno test\b/,
  /^mix test\b/,
]
/** A commit: `git commit`, also with options before it, such as `git -C dir commit` or `git -c key=value commit`. */
const COMMIT = /^git( -C \S+| -c \S+| --[\w-]+(=\S+)?)* commit(\s|$)/

/** What may come before a command and is not it: a shell running it, a subshell, quotes, `sudo`, settings for its environment. */
const WRAPPER = /^(\s+|[("'{]+|(ba|z|da|k)?sh( -\w+)* |(sudo|time|env|command|exec|nohup|nice) |timeout \S+ |\w+=("[^"]*"|'[^']*'|\S*) )/

/** One command of a command line, without what wraps it. */
function bare(part) {
  let text = part
  for (let i = 0; i < 12; i++) {
    const found = text.match(WRAPPER)
    if (!found) break
    text = text.slice(found[0].length)
  }
  return text
}

/**
 * What kind of step a tool that has finished was, for the counts a report carries
 * (docs/integrations.md, "Steps"). Only the kind leaves the machine, never the tool or the command.
 * @param {'edit' | 'read' | 'ask' | 'other'} kind what kind of tool it is, as the hook script tells it
 * @param {string} [command] for the agent's shell tool, the command it ran (an empty string when it
 *   is not known); left out for any other tool. Looked at here, only to tell a test run or a commit,
 *   and not kept or sent anywhere.
 * @returns {'edit' | 'command' | 'test' | 'search' | 'commit' | 'other' | undefined} undefined for no step: asking the listener
 */
export function stepOf(kind, command) {
  if (kind === 'ask') return undefined
  if (kind === 'edit') return 'edit'
  if (kind === 'read') return 'search'
  if (typeof command !== 'string') return 'other'
  // each command of a line such as `cd app && pnpm test | tail`; one that commits is a commit, whatever it ran first
  const parts = command.slice(0, 4000).split(/&&|\|\||[;|&\n]/).map(bare)
  if (parts.some((part) => COMMIT.test(part))) return 'commit'
  if (parts.some((part) => TESTS.some((pattern) => pattern.test(part)))) return 'test'
  return 'command'
}
