import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AtlassianBridge, BridgeSnapshot } from './bridge.js'

/** Everything the Settings page talks to lives under this prefix. */
export const ROUTE_PREFIX = '/plugins/atlassian'

/** The `webServer` service face this plugin needs (typed structurally). */
export interface RouteRegistrar {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * The host `connection` service's request fence.
 *
 * Present in web profiles: it rejects cross-site and unauthenticated callers
 * by Host/Origin and the browser login cookie. These routes are reached only
 * from the settings page, so the fence is exactly right for them — but the
 * plugin must still work without it, hence the optional shape.
 */
export interface RequestFence {
  requestRejection(req: IncomingMessage): number | undefined
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/** The Settings page's wire shape. */
interface StatusBody extends Omit<BridgeSnapshot, 'siteMismatch'> {
  siteMismatch: boolean
  ok: boolean
}

function body(bridge: AtlassianBridge, ok: boolean): StatusBody {
  return { ...bridge.snapshot(), ok }
}

/**
 * Register the Settings page's three endpoints behind one prefix route.
 *
 * @param web - The composition's web server service.
 * @param bridge - The connection the endpoints drive.
 * @param fence - Optional request fence, when the `connection` service exists.
 * @returns A disposer that unregisters the route.
 */
export function registerRoutes(
  web: RouteRegistrar,
  bridge: AtlassianBridge,
  fence: RequestFence | undefined,
): () => void {
  return web.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (fence !== undefined) {
        const rejection = fence.requestRejection(req)
        if (rejection !== undefined) {
          res.statusCode = rejection
          res.end()
          return
        }
      }

      const pathname = new URL(String(req.url), 'http://localhost').pathname
      const action = pathname.slice(ROUTE_PREFIX.length).replace(/^\//, '')
      const method = req.method ?? 'GET'

      try {
        if (action === 'status' && method === 'GET') {
          sendJson(res, 200, body(bridge, true))
          return
        }
        if (action === 'connect' && method === 'POST') {
          const snapshot = await bridge.authorize()
          sendJson(res, 200, { ...snapshot, ok: true })
          return
        }
        if (action === 'disconnect' && method === 'POST') {
          const snapshot = await bridge.disconnect()
          sendJson(res, 200, { ...snapshot, ok: true })
          return
        }
        sendJson(res, 404, { ok: false, error: `unknown endpoint: ${method} ${pathname}` })
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
  })
}
