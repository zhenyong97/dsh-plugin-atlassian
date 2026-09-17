// Capture the README / marketplace screenshots for dsh-plugin-atlassian.
//
//   node dev/capture-screenshots.mjs "http://127.0.0.1:43199/?token=..."
//
// Drives a real Chrome over the DevTools Protocol — same approach as
// dev/ui-probe.mjs, and deliberately without a browser-automation dependency:
// Node 22+ ships a global WebSocket. Writes into assets/, which is what
// screenshots.json points at.
//
// Start the app first, e.g.
//   dsh --profile atlassian-dev --patch ./dev/overlay-no-browser.yml --port 43199 --no-open

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]
const OUT_DIR = 'assets'
const PORT = 9223
const VIEWPORT = { width: 1280, height: 820 }
/** 2x so the PNGs stay sharp when a storefront scales them down. */
const SCALE = 2

const url = process.argv[2]
if (url === undefined) {
  console.error('usage: node dev/capture-screenshots.mjs "<url with token>"')
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Chrome/Edge binary found')
}

/** Minimal CDP client over the page target's WebSocket. */
class Cdp {
  #ws
  #id = 0
  #pending = new Map()

  constructor(ws) {
    this.#ws = ws
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id === undefined) return
      const entry = this.#pending.get(message.id)
      if (entry === undefined) return
      this.#pending.delete(message.id)
      entry(message)
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

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
    }
    return result.result?.value
  }

  /** Screenshot the viewport, or a clip rect within it. */
  async shot(file, clip) {
    const result = await this.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    })
    await writeFile(file, Buffer.from(result.data, 'base64'))
    console.log(`→ wrote ${file}`)
  }
}

const chromePath = findChrome()
const profileDir = await mkdtemp(join(tmpdir(), 'dsh-capture-'))
await mkdir(OUT_DIR, { recursive: true })

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    'about:blank',
  ],
  { stdio: 'ignore', windowsHide: true },
)

let cdp
try {
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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    ...VIEWPORT,
    deviceScaleFactor: SCALE,
    mobile: false,
  })

  console.log('→ navigating')
  await cdp.send('Page.navigate', { url })
  await sleep(8000)

  const openSettings = `(() => {
    const wanted = ['设置', 'Settings']
    const nodes = [...document.querySelectorAll('button, [role=button], a')]
    const hit = nodes.find((node) => wanted.some((w) => (node.textContent || '').trim() === w || (node.getAttribute('aria-label') || '').includes(w)))
    if (!hit) return false
    hit.click()
    return true
  })()`
  console.log('→ opening settings:', await cdp.evaluate(openSettings))
  await sleep(2500)

  const clickAtlassian = `(() => {
    const hit = [...document.querySelectorAll('button, [role=button], a, li')]
      .find((node) => (node.textContent || '').trim() === 'Atlassian')
    if (!hit) return false
    hit.click()
    return true
  })()`
  console.log('→ opening Atlassian section:', await cdp.evaluate(clickAtlassian))
  await sleep(2500)

  // The nav rows, cropped to the union of the row buttons. Cropping to the
  // <nav> element itself would frame the whole full-height column and leave
  // three quarters of the image empty.
  const navRect = await cdp.evaluate(`(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Atlassian')
    if (!hit) return null
    const nav = hit.closest('nav')
    if (!nav) return null
    const rects = [...nav.querySelectorAll('button')].map((b) => b.getBoundingClientRect())
    if (!rects.length) return null
    const x = Math.min(...rects.map((r) => r.x))
    const y = Math.min(...rects.map((r) => r.y))
    const right = Math.max(...rects.map((r) => r.right))
    const bottom = Math.max(...rects.map((r) => r.bottom))
    return { x, y, width: right - x, height: bottom - y }
  })()`)

  await cdp.shot(join(OUT_DIR, 'settings-page.png'))
  if (navRect !== null) {
    await cdp.shot(join(OUT_DIR, 'settings-nav.png'), {
      x: Math.max(0, navRect.x - 12),
      y: Math.max(0, navRect.y - 12),
      width: Math.min(VIEWPORT.width, navRect.width + 24),
      height: Math.min(VIEWPORT.height, navRect.height + 24),
    })
  } else {
    console.log('!! nav row not found — skipping the nav crop')
  }

  const text = await cdp.evaluate(`document.body.innerText`)
  const ok = typeof text === 'string' && text.includes('官方远程 MCP 服务器') && text.includes('可用工具')
  console.log(`\nRESULT: Atlassian settings page ${ok ? 'RENDERED' : 'NOT RENDERED'}`)
  process.exitCode = ok ? 0 : 1
} catch (error) {
  console.error('capture failed:', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try {
    await Promise.race([cdp?.send('Browser.close'), sleep(1000)])
  } catch {
    // ignore
  }
  chrome.kill()
  await sleep(500)
  await rm(profileDir, { recursive: true, force: true }).catch(() => undefined)
}
