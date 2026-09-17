import * as React from 'react'

/**
 * The browser half of dsh-plugin-atlassian.
 *
 * This file is compiled on its own (`tsconfig.client.json`) into CommonJS and
 * wrapped by `scripts/bundle-client.mjs` into the runtime's
 * `window.__ModuleLoader__.load` closure-factory. That is why it must stay a
 * SINGLE file with no relative imports: a relative `require('./x.js')` would be
 * resolved by the browser module loader, not by this package.
 */

/** Endpoints the host half serves. Must match `src/routes.ts`. */
const ROUTE_PREFIX = '/plugins/atlassian'

type Status = 'idle' | 'connecting' | 'authorizing' | 'ready' | 'error'

interface StatusPayload {
  ok: boolean
  status: Status
  authorizationUrl?: string
  site?: string
  siteMismatch: boolean
  toolCount: number
  error?: string
}

/** The client context surface this half uses (typed structurally). */
interface ClientContext {
  slots: {
    inject(key: string, callback: () => unknown): () => void
    register(options: Record<string, unknown>, component: React.ComponentType<never>): unknown
  }
}

async function call(path: string, method: 'GET' | 'POST'): Promise<StatusPayload> {
  const response = await fetch(`${ROUTE_PREFIX}${path}`, { method, cache: 'no-store' })
  if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
  const payload: unknown = await response.json()
  if (typeof payload !== 'object' || payload === null) throw new Error('malformed response')
  return payload as StatusPayload
}

const STATUS_TEXT: Record<Status, string> = {
  idle: '未连接',
  connecting: '连接中…',
  // Not "waiting for the browser": activation runs a background attempt that
  // turns out to need authorization, and no tab has been opened at that point.
  // Claiming otherwise made a first visit look like a browser had gone missing.
  authorizing: '需要授权',
  ready: '已连接',
  error: '出错',
}

const STATUS_TONE: Record<Status, string> = {
  idle: 'neutral',
  connecting: 'pending',
  authorizing: 'pending',
  ready: 'ok',
  error: 'bad',
}

const TONE_COLOR: Record<string, string> = {
  neutral: 'rgba(127,127,127,.9)',
  pending: '#c98a00',
  ok: '#1a9e5c',
  bad: '#d64545',
}

const box: React.CSSProperties = {
  border: '1px solid rgba(127,127,127,.28)',
  borderRadius: 10,
  padding: '14px 16px',
  marginBottom: 14,
}

const button: React.CSSProperties = {
  border: '1px solid rgba(127,127,127,.35)',
  borderRadius: 8,
  padding: '6px 14px',
  fontSize: '0.9em',
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
}

function Badge({ status }: { status: Status }): React.ReactElement {
  const color = TONE_COLOR[STATUS_TONE[status]] ?? TONE_COLOR['neutral']
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: '0.85em',
        color,
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: color,
          display: 'inline-block',
        }}
      />
      {STATUS_TEXT[status]}
    </span>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '5px 0', fontSize: '0.9em' }}>
      <span style={{ minWidth: 96, opacity: 0.65 }}>{label}</span>
      <span style={{ wordBreak: 'break-all' }}>{children}</span>
    </div>
  )
}

/**
 * The page's own mark.
 *
 * The shell owns the Settings nav glyph: `navIcon()` in
 * `dsh-client-ui-settings-general` matches four shipped section ids and falls
 * back to a generic settings gear for everything else, and `settings.section`
 * accepts only `id`/`order`/`label` — there is no icon option to set. So the
 * nav row cannot carry this plugin's identity, and the content column (which
 * renders no heading of its own) is where it has to live.
 */
function Mark(): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        flex: 'none',
        borderRadius: 9,
        border: '1px solid rgba(127,127,127,.28)',
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </svg>
    </span>
  )
}

/**
 * The Settings → Atlassian page.
 *
 * State is owned by the host half; this component only polls it and forwards
 * the two actions. Polling runs fast while an authorization is in flight (so
 * the URL appears promptly) and slowly once settled.
 */
function AtlassianSettings(): React.ReactElement {
  const [payload, setPayload] = React.useState<StatusPayload | undefined>(undefined)
  const [transportError, setTransportError] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)
  const mounted = React.useRef(true)
  const sequence = React.useRef(0)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = React.useCallback(async (): Promise<void> => {
    const ticket = (sequence.current += 1)
    try {
      const next = await call('/status', 'GET')
      // Only the newest request may write state: a slow early response must
      // not overwrite a newer one.
      if (mounted.current && ticket === sequence.current) {
        setPayload(next)
        setTransportError(undefined)
      }
    } catch (error) {
      if (mounted.current && ticket === sequence.current) {
        setTransportError(error instanceof Error ? error.message : String(error))
      }
    }
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const status = payload?.status ?? 'idle'
  const unsettled = status === 'connecting' || status === 'authorizing'

  React.useEffect(() => {
    const period = unsettled ? 1200 : 8000
    const handle = window.setInterval(() => {
      void refresh()
    }, period)
    return () => {
      window.clearInterval(handle)
    }
  }, [refresh, unsettled])

  const act = React.useCallback(
    async (action: 'connect' | 'disconnect'): Promise<void> => {
      setBusy(true)
      try {
        const next = await call(`/${action}`, 'POST')
        if (mounted.current) {
          setPayload(next)
          setTransportError(undefined)
        }
      } catch (error) {
        if (mounted.current) {
          setTransportError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (mounted.current) setBusy(false)
      }
    },
    [],
  )

  const authorizationUrl = payload?.authorizationUrl
  const error = transportError ?? payload?.error

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Mark />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '1.05em', fontWeight: 600, lineHeight: '1.35em' }}>Atlassian</div>
          <div style={{ opacity: 0.65, fontSize: '0.85em' }}>官方远程 MCP 服务器</div>
        </div>
      </div>

      <p style={{ opacity: 0.7, fontSize: '0.9em', marginTop: 0 }}>
        一次浏览器授权后，Jira、Confluence、Jira Service Management、Bitbucket 与 Compass 的工具
        会作为原生工具出现在 agent 的工具列表里。授权在浏览器中完成，返回后即可直接调用。
      </p>

      <div style={box}>
        <Row label="状态">
          <Badge status={status} />
        </Row>
        {payload?.site !== undefined && <Row label="站点">{payload.site}</Row>}
        <Row label="可用工具">{payload === undefined ? '—' : String(payload.toolCount)}</Row>
      </div>

      {payload?.siteMismatch === true && (
        <div style={{ ...box, borderColor: TONE_COLOR['pending'] }}>
          授权的站点（{payload.site}）与配置里预期的站点不一致。工具仍可使用，但它们指向的是上面这个站点。
        </div>
      )}

      {status === 'authorizing' && (
        <div style={box}>
          <div style={{ marginBottom: 8, fontSize: '0.9em' }}>
            点击下面的按钮会在浏览器中打开 Atlassian 授权页。若浏览器没有自动打开，也可以直接访问这个链接：
          </div>
          {authorizationUrl === undefined ? (
            <span style={{ opacity: 0.6, fontSize: '0.85em' }}>正在获取授权链接…</span>
          ) : (
            <a
              href={authorizationUrl}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.85em', wordBreak: 'break-all' }}
            >
              {authorizationUrl}
            </a>
          )}
        </div>
      )}

      {error !== undefined && (
        <div style={{ ...box, borderColor: TONE_COLOR['bad'] }}>
          <div style={{ fontSize: '0.9em', color: TONE_COLOR['bad'], marginBottom: 4 }}>失败</div>
          <div style={{ fontSize: '0.85em', opacity: 0.85, whiteSpace: 'pre-wrap' }}>{error}</div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="button"
          style={{ ...button, opacity: busy || status === 'ready' ? 0.5 : 1 }}
          disabled={busy || status === 'ready'}
          onClick={() => {
            void act('connect')
          }}
        >
          {status === 'authorizing' ? '打开授权页' : '连接 Atlassian'}
        </button>
        <button
          type="button"
          style={{ ...button, opacity: busy || status === 'idle' ? 0.5 : 1 }}
          disabled={busy || status === 'idle'}
          onClick={() => {
            void act('disconnect')
          }}
        >
          断开连接
        </button>
      </div>
    </div>
  )
}

export { AtlassianSettings }

/** Client-plane plugin name, used by the browser runtime's diagnostics. */
export const name = 'dsh-plugin-atlassian'

/** Services this client half resolves from the browser runtime. */
export const inject = ['slots']

/**
 * Mount the Settings page.
 *
 * `settings.section` is a list slot: a fresh `id` gets this page added beside
 * the shipped ones, while reusing a shipped id would replace that page — so
 * the id here is deliberately this plugin's own.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'atlassian',
        order: 30,
        label: 'Atlassian',
      },
      AtlassianSettings as unknown as React.ComponentType<never>,
    ),
  )
}
