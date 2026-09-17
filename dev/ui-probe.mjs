// Headless UI probe for dsh-plugin-atlassian.
//
// Drives a real Chrome over the DevTools Protocol (no browser-automation
// dependency: Node 22+ ships a global WebSocket) to answer the one question a
// host-side test cannot: does the Settings page actually appear and render?
//
//   node dev/ui-probe.mjs "http://127.0.0.1:43199/?token=..."
//
// Exits non-zero when the Atlassian entry is not found, so it can gate a build.

import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
const PORT = 9222
const url = process.argv[2]
if (url === undefined) {
  console.error('usage: node dev/ui-probe.mjs "<url with token>"')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findChrome() {
  const { existsSync } = await import('node:fs')
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Chrome/Edge binary found')
}

/** Minimal CDP client over the page target's WebSocket. */
class Cdp {
  #ws
  #id = 0
  #pending = new Map()
  /** Console errors and uncaught exceptions seen so far. */
  problems = []

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.#pending.get(message.id)
        if (entry !== undefined) {
          this.#pending.delete(message.id)
          entry(message)
        }
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails
        this.problems.push(`exception: ${details?.exception?.description ?? details?.text ?? 'unknown'}`)
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
        const text = (message.params.args ?? [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
        if (text !== '') this.problems.push(`console.error: ${text}`)
      }
    })
  }

  send(method, params = {}) {
    const id = (this.#id += 1)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30_000)
      this.#pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error !== undefined) reject(new Error(`${method}: ${message.error.message}`))
        else resolve(message.result)
      })
      this.#ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate an expression in the page and return its value. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }
}

const chromePath = await findChrome()
const profileDir = await mkdtemp(join(tmpdir(), 'dsh-ui-probe-'))
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let cdp
try {
  // Wait for the debugging endpoint, then attach to the page target.
  let target
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const targets = await response.json()
      target = targets.find((entry) => entry.type === 'page')
      if (target !== undefined) break
    } catch {
      // Not listening yet.
    }
    await sleep(500)
  }
  if (target === undefined) throw new Error('Chrome debugging endpoint never became ready')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', () => reject(new Error('CDP WebSocket failed')), { once: true })
  })
  cdp = new Cdp(ws)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')

  console.log('→ navigating')
  await cdp.send('Page.navigate', { url })
  await sleep(7000)

  // Walk the settings panel: click whatever opens Settings, then the section.
  const openSettings = `(() => {
    const wanted = ['设置', 'Settings']
    const nodes = [...document.querySelectorAll('button, [role=button], a')]
    const hit = nodes.find((node) => wanted.some((w) => (node.textContent || '').trim() === w || (node.getAttribute('aria-label') || '').includes(w)))
    if (!hit) return { clicked: false, candidates: nodes.map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 40) }
    hit.click()
    return { clicked: true, label: (hit.textContent || '').trim() }
  })()`
  console.log('→ opening settings:', JSON.stringify(await cdp.evaluate(openSettings)))
  await sleep(2500)

  const sections = await cdp.evaluate(
    `[...document.querySelectorAll('button, [role=button], a, li')].map((n) => (n.textContent || '').trim()).filter(Boolean)`,
  )
  const navEntries = [...new Set(sections)].filter((text) => text.length < 40)
  console.log('→ settings nav entries:', JSON.stringify(navEntries))

  const clickAtlassian = `(() => {
    const nodes = [...document.querySelectorAll('button, [role=button], a, li')]
    const hit = nodes.find((node) => (node.textContent || '').trim() === 'Atlassian')
    if (!hit) return false
    hit.click()
    return true
  })()`
  const clicked = await cdp.evaluate(clickAtlassian)
  console.log('→ clicked Atlassian entry:', clicked)
  await sleep(2500)

  const panel = await cdp.evaluate(`document.body.innerText`)
  console.log('===== PAGE TEXT =====')
  console.log(panel)
  console.log('=====================')

  // Assert on the page's own copy, not on a button label: the connect button
  // reads differently depending on connection state, and asserting on it made
  // an earlier run report NOT RENDERED for a page that had rendered fine.
  const found =
    typeof panel === 'string' &&
    panel.includes('Atlassian 官方远程 MCP') &&
    panel.includes('可用工具')
  console.log(`\nRESULT: Atlassian settings page ${found ? 'RENDERED' : 'NOT RENDERED'}`)
  if (cdp.problems.length > 0) {
    console.log('\nPAGE PROBLEMS:')
    for (const problem of [...new Set(cdp.problems)]) console.log(`  - ${problem}`)
  } else {
    console.log('PAGE PROBLEMS: none')
  }
  process.exitCode = found ? 0 : 1
} catch (error) {
  console.error('probe failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try {
    // Fire-and-forget: the page target may already be gone, and a rejected
    // close must not mask the probe's real result.
    await Promise.race([cdp?.send('Browser.close'), sleep(1000)])
  } catch {
    // ignore
  }
  chrome.kill()
  await sleep(500)
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
}
