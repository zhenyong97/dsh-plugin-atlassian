/**
 * The Jira board: a read-mostly projection of the same MCP connection the
 * agent uses.
 *
 * It exists so the panel never needs a model turn to answer "what is on my
 * plate". Everything here is a thin, defensive read over the bridged tools:
 * MCP answers arrive as content blocks carrying JSON text, and a site's issue
 * data is arbitrary, so every field is narrowed rather than trusted.
 *
 * The one write is a status transition. It is deliberately explicit — the
 * panel shows the transitions the server currently offers and sends back one
 * exact id — because Jira workflows are per-project state machines that no
 * client can guess.
 *
 * @module
 */

import type { AtlassianBridge } from './bridge.js'

/** Fragment patterns for the tools this module needs. */
const TOOL = {
  resources: /accessibleatlassianresources/i,
  search: /searchJiraIssuesUsingJql/i,
  issue: /^getJiraIssue$/i,
  transitions: /getTransitionsForJiraIssue/i,
  transition: /^transitionJiraIssue$/i,
  projects: /getVisibleJiraProjects/i,
} as const

/** Compile every pattern once, so a fragment matches case-insensitively. */
const MATCHERS: Record<keyof typeof TOOL, RegExp> = {
  resources: new RegExp(TOOL.resources.source, 'i'),
  search: new RegExp(TOOL.search.source, 'i'),
  issue: new RegExp(TOOL.issue.source, 'i'),
  transitions: new RegExp(TOOL.transitions.source, 'i'),
  transition: new RegExp(TOOL.transition.source, 'i'),
  projects: new RegExp(TOOL.projects.source, 'i'),
}

/**
 * The tool surface this module needs.
 *
 * Structural rather than the concrete bridge so the data layer stays testable
 * and so a missing tool is a diagnosable error at call time instead of a
 * crash at wiring time.
 */
export interface ToolBridge {
  rawNameMatching(pattern: RegExp): string | undefined
  callTool(rawName: string, args: Record<string, unknown>, timeoutMs?: number): Promise<readonly unknown[]>
  /** Coarse connection state, used to tell "not connected" from "no such tool". */
  snapshot?(): { status: string; error?: string | undefined }
}

/** One status as the panel renders it. */
export interface BoardStatus {
  /** Status name, e.g. `开发中`. Doubles as the identity of a column. */
  name: string
  /** Jira's coarse bucket: `new` | `indeterminate` | `done` | `undefined`. */
  categoryKey: string
  /** Human label of the bucket, for grouping headers. */
  categoryName: string
  /** Jira's own colour hint for the bucket. */
  colorName: string
}

/** One issue, flattened to exactly what a card or a drawer shows. */
export interface BoardIssue {
  key: string
  id: string
  summary: string
  status: BoardStatus
  /** Issue type name, e.g. `故事`, `缺陷`. */
  type: string
  priority: string | undefined
  /**
   * Assignee display name, when the issue has one.
   *
   * Frequently unset: a site whose issues are unassigned for the whole backlog
   * reports `null` here, and the panel must treat that as an ordinary state
   * rather than an empty filter.
   */
  assignee: string | undefined
  /** Reporter display name. Usually present even when nobody is assigned. */
  reporter: string | undefined
  updated: string | undefined
  projectKey: string | undefined
  projectName: string | undefined
  /** Open-in-Jira target, built from the authorized site. */
  url: string | undefined
}

/** One status transition the server currently offers on an issue. */
export interface BoardTransition {
  id: string
  name: string
  toName: string
  toCategoryKey: string
}

/** A project the authorization can see. */
export interface BoardProject {
  key: string
  name: string
}

/** One issue plus its long-form body. */
export interface BoardIssueDetail {
  issue: BoardIssue
  /** Description as the MCP server rendered it (Markdown). */
  description: string
}

/** Everything one board render needs. */
export interface BoardPayload {
  /** Issues matching the effective query, newest update first. */
  issues: readonly BoardIssue[]
  /** True when the built-in bounded fallback produced the result, not the caller's JQL. */
  constrained: boolean
  /** The exact JQL that produced `issues`. */
  jql: string
  /** Authorized site host, when known. */
  site: string | undefined
  /** Registry it resolved the site from, when it had to. */
  cloudId: string | undefined
  truncated: boolean
  limit: number
}

/** Why a board read failed, in a form the panel can render. */
export class BoardError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'BoardError'
    this.code = code
  }
}

/** Narrow an unknown to a plain record. */
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
}

/** A non-empty string, or undefined. */
function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Concatenate the text blocks of an MCP content array. */
function contentText(content: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of content) {
    const item = record(block)
    const value = item === undefined ? undefined : text(item['text'])
    if (value !== undefined) parts.push(value)
  }
  return parts.join('\n')
}

/**
 * Parse a tool answer that should be JSON.
 *
 * The MCP server answers these tools with a JSON document inside a text block.
 * Some deployments wrap it in a fenced code block, so a leading fence is
 * stripped before parsing; anything else is reported as a shape error rather
 * than silently yielding an empty board.
 */
function parseJson(content: readonly unknown[], what: string): unknown {
  const raw = contentText(content).trim()
  if (raw === '') throw new BoardError('empty', `${what}：服务端返回了空内容`)
  const unfenced = raw.startsWith('```')
    ? raw.replace(/^```[a-zA-Z]*\s*/, '').replace(/```\s*$/, '')
    : raw
  try {
    return JSON.parse(unfenced)
  } catch {
    throw new BoardError('unparsable', `${what}：无法解析服务端返回（前 200 字符）${raw.slice(0, 200)}`)
  }
}

/** Read a nested string field by path. */
function at(value: unknown, ...path: readonly string[]): unknown {
  let current: unknown = value
  for (const step of path) {
    const item = record(current)
    if (item === undefined) return undefined
    current = item[step]
  }
  return current
}

/** Read a nested non-empty string by path. */
function textAt(value: unknown, ...path: readonly string[]): string | undefined {
  return text(at(value, ...path))
}

/**
 * Map a status object, defaulting the bucket when the server omits it.
 *
 * Every issue carries an embedded status, so the panel can group by status
 * name without a second request per issue.
 */
function statusOf(value: unknown): BoardStatus {
  const category = at(value, 'statusCategory')
  return {
    name: textAt(value, 'name') ?? '未知状态',
    categoryKey: textAt(category, 'key') ?? 'undefined',
    categoryName: textAt(category, 'name') ?? '未分类',
    colorName: textAt(category, 'colorName') ?? 'blue-gray',
  }
}

/** Flatten one issue payload. Returns undefined when it carries no key. */
function issueOf(value: unknown, site: string | undefined): BoardIssue | undefined {
  const key = textAt(value, 'key')
  if (key === undefined) return undefined
  const fields = at(value, 'fields')
  const projectKey = textAt(fields, 'project', 'key')
  return {
    key,
    id: textAt(value, 'id') ?? key,
    summary: textAt(fields, 'summary') ?? '(无标题)',
    status: statusOf(at(fields, 'status')),
    type: textAt(fields, 'issuetype', 'name') ?? '',
    priority: textAt(fields, 'priority', 'name'),
    assignee: textAt(fields, 'assignee', 'displayName'),
    reporter: textAt(fields, 'reporter', 'displayName'),
    updated: textAt(fields, 'updated'),
    projectKey,
    projectName: textAt(fields, 'project', 'name'),
    url:
      site === undefined
        ? undefined
        : `https://${site}/browse/${encodeURIComponent(key)}`,
  }
}

/**
 * Turn a JQL restriction failure into a hint the user can act on.
 *
 * Atlassian refuses wholly unconstrained queries, and the message is the only
 * signal that the query itself — not the connection — is the problem.
 */
function looksUnconstrained(message: string): boolean {
  return /unbounded|unrestricted|不允许使用无限制|add a search restriction|至少/i.test(message)
}

/** A board query: the JQL plus the paging window. */
export interface BoardQuery {
  /** Caller-supplied JQL, or the deployment default when omitted. */
  jql?: string | undefined
  limit: number
  timeoutMs: number
}

/**
 * One board over one bridge.
 *
 * The authorized site and its registry id are resolved once and cached, since
 * every Jira tool on this server requires the id explicitly and re-resolving it
 * per request would double the round-trips of every refresh.
 */
export class JiraBoard {
  readonly #bridge: ToolBridge
  #cloudId: string | undefined
  #resolving: Promise<string> | undefined

  constructor(bridge: ToolBridge) {
    this.#bridge = bridge
  }

  /** Whether the panel can be served at all right now. */
  available(): boolean {
    return this.#bridge.rawNameMatching(MATCHERS.search) !== undefined
  }

  /** The cached authorized site host, once known. */
  get site(): string | undefined {
    return this.#site
  }

  #site: string | undefined

  /**
   * Call one tool by fragment, failing with the fragment when it is absent.
   *
   * @param pattern - Fragment identifying the tool.
   * @param args - Tool arguments.
   * @param timeoutMs - Optional deadline override.
   * @returns The MCP content blocks.
   */
  async #call(pattern: RegExp, args: Record<string, unknown>, timeoutMs?: number): Promise<readonly unknown[]> {
    const rawName = this.#bridge.rawNameMatching(pattern)
    if (rawName === undefined) {
      // An unconnected bridge has discovered no tools at all, and calling that
      // "the server did not provide this tool" sends the user hunting for a
      // permission problem instead of connecting.
      const health = this.#bridge.snapshot?.()
      if (health !== undefined && health.status !== 'ready') {
        throw new BoardError(
          'not-connected',
          health.error ?? `Atlassian 连接尚未就绪（状态：${health.status}）— 到 设置 → Atlassian 完成连接`,
        )
      }
      throw new BoardError(
        'missing-tool',
        `服务端没有提供匹配 ${String(pattern)} 的工具 — 可能未授权 Jira 产品`,
      )
    }
    try {
      return await this.#bridge.callTool(rawName, args, timeoutMs)
    } catch (error) {
      throw new BoardError('tool-failed', error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * The registry id (UUID or host) every Jira tool requires.
   *
   * The first authorized resource is the site the token is scoped to — this
   * authorization covers exactly one, so "first" is not a guess.
   */
  async cloudId(): Promise<string> {
    if (this.#cloudId !== undefined) return this.#cloudId
    if (this.#resolving === undefined) {
      this.#resolving = (async (): Promise<string> => {
        const content = await this.#call(MATCHERS.resources, {}, 20_000)
        const parsed = parseJson(content, '查询可访问站点')
        const list = Array.isArray(parsed) ? parsed : [parsed]
        for (const entry of list) {
          const id = textAt(entry, 'id')
          if (id === undefined) continue
          const url = textAt(entry, 'url')
          if (url !== undefined) {
            try {
              this.#site = new URL(url).host
            } catch {
              this.#site = url
            }
          }
          this.#cloudId = id
          return id
        }
        throw new BoardError('no-site', '授权里没有任何可访问的 Jira 站点')
      })().finally(() => {
        this.#resolving = undefined
      })
    }
    return this.#resolving
  }

  /**
   * Load the board.
   *
   * Two query attempts at most: a JQL the deployment or the user supplied, and
   * — only when the server refused it as unconstrained — a bounded fallback.
   * Any other failure is reported as-is rather than retried, because a bad JQL
   * should be visible, not silently replaced.
   */
  async load(query: BoardQuery): Promise<BoardPayload> {
    const requested = query.jql?.trim() ?? ''
    const fallback = 'updated >= -180d ORDER BY updated DESC'
    let jql = requested === '' ? fallback : requested
    // Tracks whether the FALLBACK is already in force, which is what bounds the
    // loop to one retry. It is not "the user supplied something": a user JQL
    // that the server rejects as unconstrained is exactly the case the fallback
    // exists for.
    let usedFallback = requested === ''

    for (;;) {
      const cloudId = await this.cloudId()
      let parsed: unknown
      try {
        const content = await this.#call(
          MATCHERS.search,
          {
            cloudId,
            jql,
            fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter', 'updated', 'project'],
            maxResults: query.limit,
          },
          query.timeoutMs,
        )
        parsed = parseJson(content, '搜索工单')
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!usedFallback && looksUnconstrained(message)) {
          usedFallback = true
          jql = fallback
          continue
        }
        throw error
      }

      const source = at(parsed, 'issues')
      const rawIssues = Array.isArray(source) ? source : []
      const issues: BoardIssue[] = []
      for (const raw of rawIssues) {
        const issue = issueOf(raw, this.#site)
        if (issue !== undefined) issues.push(issue)
      }
      return {
        issues,
        constrained: jql === fallback && requested !== fallback,
        jql,
        site: this.#site,
        cloudId,
        truncated: at(parsed, 'isLast') === false,
        limit: query.limit,
      }
    }
  }

  /** One issue with its description, for the drawer. */
  async detail(key: string, timeoutMs: number): Promise<BoardIssueDetail> {
    const cloudId = await this.cloudId()
    const content = await this.#call(
      MATCHERS.issue,
      { cloudId, issueIdOrKey: key, responseContentFormat: 'markdown' },
      timeoutMs,
    )
    const parsed = parseJson(content, `读取 ${key}`)
    // `getJiraIssue` may answer with the issue directly or inside `issues`.
    const candidate = at(parsed, 'issues', '0') ?? parsed
    const issue = issueOf(candidate, this.#site)
    if (issue === undefined) throw new BoardError('not-found', `读不到 ${key} 的内容`)
    return {
      issue,
      description: (textAt(candidate, 'fields', 'description') ?? '').trim(),
    }
  }

  /** The transitions the server currently offers on one issue. */
  async transitions(key: string, timeoutMs: number): Promise<readonly BoardTransition[]> {
    const cloudId = await this.cloudId()
    const content = await this.#call(
      MATCHERS.transitions,
      { cloudId, issueIdOrKey: key },
      timeoutMs,
    )
    const parsed = parseJson(content, `读取 ${key} 的可用流转`)
    const source = at(parsed, 'transitions')
    const list = Array.isArray(source) ? source : []
    const out: BoardTransition[] = []
    for (const raw of list) {
      const id = textAt(raw, 'id')
      const name = textAt(raw, 'name')
      if (id === undefined || name === undefined) continue
      out.push({
        id,
        name,
        toName: textAt(raw, 'to', 'name') ?? name,
        toCategoryKey: textAt(raw, 'to', 'statusCategory', 'key') ?? 'undefined',
      })
    }
    return out
  }

  /**
   * Apply one transition.
   *
   * The id must have come from {@link transitions} for this same issue: the
   * panel never constructs one, because a transition id is only meaningful
   * inside the workflow state it was read from.
   */
  async transition(key: string, transitionId: string, timeoutMs: number): Promise<void> {
    const cloudId = await this.cloudId()
    await this.#call(
      MATCHERS.transition,
      { cloudId, issueIdOrKey: key, transition: { id: transitionId } },
      timeoutMs,
    )
  }

  /** Projects this authorization can see. */
  async projects(timeoutMs: number): Promise<readonly BoardProject[]> {
    const cloudId = await this.cloudId()
    // Deliberately no `maxResults`: this tool caps it at 50, and the server's
    // own default is the page size it is willing to serve.
    const content = await this.#call(MATCHERS.projects, { cloudId }, timeoutMs)
    const parsed = parseJson(content, '读取项目列表')
    const source = at(parsed, 'values') ?? parsed
    const list = Array.isArray(source) ? source : []
    const out: BoardProject[] = []
    for (const raw of list) {
      const key = textAt(raw, 'key')
      if (key === undefined) continue
      out.push({ key, name: textAt(raw, 'name') ?? key })
    }
    return out.sort((a, b) => a.key.localeCompare(b.key))
  }
}

/** Build a board over the live bridge. */
export function createBoard(bridge: AtlassianBridge): JiraBoard {
  return new JiraBoard(bridge)
}
