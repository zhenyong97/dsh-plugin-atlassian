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

/** Settings section label. Used for the registration AND to find the nav row. */
const SECTION_LABEL = 'Atlassian'

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
 * The mark's geometry. Shared by the React header below and the nav-glyph
 * patch, so the two can never drift apart.
 *
 * It is a link, not the Atlassian logo: this is an unofficial bridge, the mark
 * has to read at 16px, and drawing someone's trademark into a third-party
 * plugin's chrome is a licensing question nobody needs.
 */
const MARK_PATHS = [
  'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71',
  'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
]

/** Marker attribute so the patch never re-wraps its own output. */
const GLYPH_FLAG = 'data-dsh-atlassian-glyph'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Build the nav glyph as a detached SVG element.
 *
 * Built through the DOM rather than by parsing an HTML string: an `<svg>` only
 * becomes an SVG-namespaced element when the parser knows it is in SVG
 * context, and `innerHTML` on a `<div>` silently produces an inert HTML
 * element that renders as nothing.
 */
function navGlyph(): Element {
  const doc = document.implementation.createDocument(SVG_NS, 'svg', null)
  const svg = doc.documentElement
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.6')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute(GLYPH_FLAG, '1')
  for (const d of MARK_PATHS) {
    const path = doc.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  }
  return svg
}

/**
 * Replace the shell's generic settings gear on this plugin's Settings nav row.
 *
 * There is no supported way to do this. `settings.section` accepts only
 * `id`/`order`/`label` — no slot in the whole client contract has an `icon`
 * option — and the shell hardcodes the nav glyph by section id,
 * (`navIcon()` in `dsh-client-ui-settings-general`), falling back to a generic
 * gear for every id it does not ship. So the row is found by its own label and
 * the SVG swapped in place.
 *
 * This is a workaround, and it is written to fail safe: it matches only a
 * `<button>` whose trimmed text is exactly our label (the page's own heading is
 * a `<div>`, so it cannot be caught), it never throws, and if the shell changes
 * its markup the only outcome is that the gear stays. Everything it touches is
 * cosmetic and lives inside the settings modal.
 */
function patchNavGlyph(): void {
  for (const button of document.querySelectorAll('button')) {
    if ((button.textContent ?? '').trim() !== SECTION_LABEL) continue
    const current = button.querySelector('svg')
    if (current === null || current.hasAttribute(GLYPH_FLAG)) continue
    const replacement = navGlyph()
    // Adopt the shell's own class so sizing and colour stay the shell's business.
    const className = current.getAttribute('class')
    if (className !== null) replacement.setAttribute('class', className)
    current.replaceWith(replacement)
  }
}

/** The page's own mark, drawn from the same geometry as the nav glyph. */
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
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
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

  // Keep the nav row's glyph patched while this page is open. The observer is
  // scoped to this page's lifetime — the only time the nav row and this
  // component are on screen together — and coalesces bursts through a frame so
  // the periodic status re-render does not turn into a querySelectorAll storm.
  // The GLYPH_FLAG guard is what stops the patch's own mutation from
  // re-entering: after the swap the guard hits and nothing more is written.
  React.useEffect(() => {
    let frame = 0
    const schedule = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        patchNavGlyph()
      })
    }
    schedule()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
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
        label: SECTION_LABEL,
      },
      AtlassianSettings as unknown as React.ComponentType<never>,
    ),
  )
}
