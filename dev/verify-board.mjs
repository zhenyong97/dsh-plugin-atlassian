// Exercises the compiled board against captured real Atlassian MCP payloads.
//
// A live board test would need an OAuth authorization; this harness supplies
// the same bytes the MCP server returns (captured from the real site) to the
// real `JiraBoard` class, so JSON parsing, field mapping, column grouping, and
// the unconstrained-JQL fallback are all covered without a connection.
//
// The ONE thing this cannot cover is `tools/call` transport itself — that path
// is exercised by the existing bridged tools in a normal session.
//
// Run with: node dev/verify-board.mjs

import { JiraBoard } from '../lib/board.js'

const SITE = 'example.atlassian.net'
const CLOUD_ID = '11111111-2222-4333-8444-555555555555'

/** Wrap a JSON document the way the MCP server does: one text content block. */
const block = (value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]

/** Real response shape from `getAccessibleAtlassianResources`. */
const RESOURCES = [
  { id: CLOUD_ID, url: `https://${SITE}`, name: 'example', scopes: ['read:jira-work', 'write:jira-work'] },
]

/** Real response shape from `searchJiraIssuesUsingJql`, trimmed to two issues. */
const SEARCH = {
  issues: [
    {
      id: '10107',
      key: 'DEMOAPP-27',
      fields: {
        summary: '示例任务：等级铭牌与奖励结算反馈',
        issuetype: { id: '10005', name: '故事', subtask: false },
        project: { id: '10003', key: 'DEMOAPP', name: '示例｜用户 App' },
        description: '## 示例描述\n\n* 示例要点一。\n* 示例要点二。\n\n[示例链接](https://example.com/README.md)',
        assignee: null,
        priority: { id: '2', name: 'High' },
        updated: '2026-09-17T03:44:29.154+0800',
        status: {
          id: '10010',
          name: '开发中',
          statusCategory: { id: 4, key: 'indeterminate', colorName: 'yellow', name: '正在进行' },
        },
      },
    },
    {
      id: '10168',
      key: 'DEMOAPP-34',
      fields: {
        summary: '示例任务：地址与物流展示',
        issuetype: { id: '10005', name: '故事', subtask: false },
        project: { id: '10003', key: 'DEMOAPP', name: '示例｜用户 App' },
        description: null,
        assignee: { displayName: 'Example User' },
        priority: { id: '4', name: 'Low' },
        updated: '2026-09-17T03:44:48.983+0800',
        status: {
          id: '10008',
          name: '待梳理',
          statusCategory: { id: 2, key: 'new', colorName: 'blue-gray', name: '待办' },
        },
      },
    },
  ],
  isLast: true,
}

/** Real response shape from `getTransitionsForJiraIssue`. */
const TRANSITIONS = {
  expand: 'transitions',
  transitions: [
    { id: '11', name: '待梳理', to: { name: '待梳理', statusCategory: { key: 'new' } }, isAvailable: true },
    { id: '21', name: '待开发', to: { name: '待开发', statusCategory: { key: 'new' } }, isAvailable: true },
    { id: '61', name: '已完成', to: { name: '已完成', statusCategory: { key: 'done' } }, isAvailable: true },
  ],
}

/** Real response shape from `getVisibleJiraProjects`. */
const PROJECTS = {
  maxResults: 50,
  total: 2,
  isLast: true,
  values: [
    { id: '10004', key: 'DEMOAPI', name: '示例｜App 业务 API' },
    { id: '10003', key: 'DEMOAPP', name: '示例｜用户 App' },
  ],
}

/**
 * A bridge double that answers by tool fragment.
 *
 * It also asserts that the cloudId is threaded through: the DSH session tools
 * inject it for the model, but a plugin must carry it itself, and a board that
 * quietly dropped it would fail against the real server.
 */
function fakeBridge() {
  const calls = []
  const names = {
    resources: 'getAccessibleAtlassianResources',
    search: 'searchJiraIssuesUsingJql',
    issue: 'getJiraIssue',
    transitions: 'getTransitionsForJiraIssue',
    transition: 'transitionJiraIssue',
    projects: 'getVisibleJiraProjects',
  }
  return {
    calls,
    rawNameMatching(pattern) {
      for (const raw of Object.values(names)) if (pattern.test(raw)) return raw
      return undefined
    },
    async callTool(rawName, args) {
      calls.push({ rawName, args })
      if (rawName === names.resources) return block(RESOURCES)
      if (rawName === names.search) return block(SEARCH)
      if (rawName === names.issue) return block({ ...SEARCH.issues[0], fields: SEARCH.issues[0].fields })
      if (rawName === names.transitions) return block(TRANSITIONS)
      if (rawName === names.transition) return block('Issue DEMOAPP-27 transitioned')
      if (rawName === names.projects) return block(PROJECTS)
      return block('unknown tool')
    },
  }
}

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const bridge = fakeBridge()
const board = new JiraBoard(bridge)

console.log('board.load()')
const payload = await board.load({ limit: 50, timeoutMs: 5000 })
check('returns both issues', payload.issues.length === 2, `got ${String(payload.issues.length)}`)
check('resolves the authorized site', payload.site === SITE, String(payload.site))
check('resolves the registry id', payload.cloudId === CLOUD_ID, String(payload.cloudId))

const grown = payload.issues.find((issue) => issue.key === 'DEMOAPP-27')
check('maps key/summary', grown?.summary === '示例任务：等级铭牌与奖励结算反馈', grown?.summary)
check('maps the status name', grown?.status.name === '开发中', grown?.status.name)
check('maps the status category', grown?.status.categoryKey === 'indeterminate', grown?.status.categoryKey)
check('maps the category label', grown?.status.categoryName === '正在进行', grown?.status.categoryName)
check('maps the issue type', grown?.type === '故事', grown?.type)
check('maps priority', grown?.priority === 'High', grown?.priority)
check('maps the project', grown?.projectKey === 'DEMOAPP' && grown?.projectName === '示例｜用户 App', grown?.projectKey)
check('builds the browse URL', grown?.url === `https://${SITE}/browse/DEMOAPP-27`, grown?.url)
check('leaves a null assignee unset', grown?.assignee === undefined, String(grown?.assignee))

const unassigned = payload.issues.find((issue) => issue.key === 'DEMOAPP-34')
check('maps a present assignee', unassigned?.assignee === 'Example User', unassigned?.assignee)
check('leaves a null description out of the card model', !('description' in (unassigned ?? {})), 'description leaked')

const searchCall = bridge.calls.find((call) => call.rawName === 'searchJiraIssuesUsingJql')
check('carries cloudId into the search', searchCall?.args.cloudId === CLOUD_ID, String(searchCall?.args.cloudId))
check('requests the fields the panel renders', Array.isArray(searchCall?.args.fields) && searchCall.args.fields.includes('status'))
check('honours the limit', searchCall?.args.maxResults === 50, String(searchCall?.args.maxResults))

// The unconstrained-JQL fallback: Atlassian refuses a bare `order by`, and the
// board must retry with a bounded query rather than surface that as an error.
console.log('\nunconstrained JQL fallback')
const refusing = {
  calls: [],
  rawNameMatching: bridge.rawNameMatching,
  async callTool(rawName, args) {
    this.calls.push({ rawName, args })
    if (rawName === 'getAccessibleAtlassianResources') return block(RESOURCES)
    if (rawName === 'searchJiraIssuesUsingJql') {
      if (!/updated >=/.test(String(args.jql))) {
        throw new Error('Bad Request. 此处不允许使用无限制的 JQL 查询。请在查询中添加搜索限制。')
      }
      return block(SEARCH)
    }
    return block('{}')
  },
}
const recovering = new JiraBoard(refusing)
const fallback = await recovering.load({ jql: 'order by updated DESC', limit: 50, timeoutMs: 5000 })
check('retries with a bounded query', /updated >=/.test(fallback.jql), fallback.jql)
check('marks the result as constrained', fallback.constrained === true)
check('still returns issues', fallback.issues.length === 2, String(fallback.issues.length))

// A genuinely broken query must surface, not be silently replaced.
console.log('\nbad JQL is reported')
const broken = {
  calls: [],
  rawNameMatching: bridge.rawNameMatching,
  async callTool(rawName) {
    if (rawName === 'getAccessibleAtlassianResources') return block(RESOURCES)
    throw new Error("Field 'nonsense' does not exist or you do not have permission to view it.")
  },
}
let surfaced = ''
try {
  await new JiraBoard(broken).load({ jql: 'nonsense = 1', limit: 10, timeoutMs: 5000 })
} catch (error) {
  surfaced = error instanceof Error ? error.message : String(error)
}
check('propagates the server message', /does not exist/i.test(surfaced), surfaced)

console.log('\nboard.detail()')
const detail = await board.detail('DEMOAPP-27', 5000)
check('returns the description as markdown', detail.description.startsWith('## 示例描述'), detail.description.slice(0, 40))
check('returns the issue too', detail.issue.key === 'DEMOAPP-27')
check('uses the issue-level tool', bridge.calls.some((call) => call.rawName === 'getJiraIssue'))

console.log('\nboard.transitions()')
const transitions = await board.transitions('DEMOAPP-27', 5000)
check('maps every transition', transitions.length === 3, String(transitions.length))
check('maps the target status name', transitions[2]?.toName === '已完成', transitions[2]?.toName)
check('maps the target category', transitions[2]?.toCategoryKey === 'done', transitions[2]?.toCategoryKey)

console.log('\nboard.transition()')
await board.transition('DEMOAPP-27', '61', 5000)
const applied = bridge.calls.filter((call) => call.rawName === 'transitionJiraIssue').pop()
check('sends the transition as { id }', applied?.args.transition?.id === '61', JSON.stringify(applied?.args))
check('carries cloudId into the write', applied?.args.cloudId === CLOUD_ID, String(applied?.args.cloudId))

console.log('\nboard.projects()')
const projects = await board.projects(5000)
check('lists the visible projects', projects.length === 2, String(projects.length))
check('sorts by key', projects[0]?.key === 'DEMOAPI', projects[0]?.key)

console.log('\nnot connected')
const offline = new JiraBoard({
  rawNameMatching: () => undefined,
  async callTool() {
    throw new Error('unreachable')
  },
})
check('reports itself unavailable', offline.available() === false)
let offlineError = ''
try {
  await offline.load({ limit: 10, timeoutMs: 1000 })
} catch (error) {
  offlineError = error instanceof Error ? error.message : String(error)
}
check('fails with a diagnosable code', offlineError.includes('没有提供匹配'), offlineError)

// A bridge that is still authorizing has discovered no tools either — but that
// is a connection problem, and saying "no such tool" would send the user
// looking for a permission they do not need.
console.log('\nstill authorizing')
const authorizing = new JiraBoard({
  rawNameMatching: () => undefined,
  async callTool() {
    throw new Error('unreachable')
  },
  snapshot: () => ({ status: 'authorizing' }),
})
let authError = ''
try {
  await authorizing.load({ limit: 10, timeoutMs: 1000 })
} catch (error) {
  authError = error instanceof Error ? error.message : String(error)
}
check('points at the connection, not at tool permissions', authError.includes('连接尚未就绪'), authError)
check('names the state', authError.includes('authorizing'), authError)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
