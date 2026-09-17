import z from '@deepseek-ai/schemastery'

/**
 * The `config:` block of this plugin's composition row.
 *
 * Everything here is deployment-owned: the row in `cordis.patch.yml` states it,
 * and the loader applies the schema below for anything omitted.
 */
export interface Config {
  /**
   * Namespace for the model-facing tool names. Every bridged tool appears as
   * `mcp__<serverName>__<rawName>`, matching `@deepseek-ai/dsh-mcp-client` so
   * the two can coexist and session history stays readable.
   */
  serverName: string
  /** Atlassian remote MCP endpoint (Streamable HTTP). */
  url: string
  /**
   * Loopback port for the OAuth redirect URI. `0` picks a free port.
   *
   * Dynamic client registration binds the exact redirect URI, so a port that
   * changes between runs invalidates the stored registration and forces a new
   * one. Keep it fixed unless something else owns the port.
   */
  redirectPort: number
  /** Deadline for one `tools/call`, in milliseconds. */
  toolCallTimeoutMs: number
  /**
   * Site the user is expected to authorize, e.g. `acme.atlassian.net`.
   * Shown in Settings, and checked once authorization completes so a wrong
   * site produces a clear message instead of mysteriously empty tools.
   * Empty string disables the check.
   */
  expectedSite: string
  /** How long to wait for the browser to return an authorization code. */
  authorizationTimeoutMs: number
  /** Open the system browser automatically when authorization is required. */
  autoOpenBrowser: boolean
}

export const Config = z.object({
  serverName: z.string().default('atlassian'),
  url: z.string().default('https://mcp.atlassian.com/v1/mcp'),
  redirectPort: z.number().step(1).min(0).max(65535).default(3334),
  toolCallTimeoutMs: z.number().step(1).min(1).default(60000),
  expectedSite: z.string().default(''),
  authorizationTimeoutMs: z.number().step(1).min(1000).default(300000),
  autoOpenBrowser: z.boolean().default(true),
})
