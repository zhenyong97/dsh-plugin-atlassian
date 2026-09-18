// Shared Chrome-over-CDP driver for the dev probes.
//
// No browser-automation dependency: Node 22+ ships a global WebSocket, and the
// probes only need navigate / click / read text / screenshot. The Settings and
// board probes share this so their behaviour cannot drift apart.
//
// Run with Chrome already on PATH candidates below; each probe opens its own
// throwaway profile and closes the browser when done.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
]

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** The first installed Chrome/Edge binary. */
export function findChrome() {
  for (const candidate of CHROME_CANDIDATES) if (existsSync(candidate)) return candidate
  throw new Error('no Chrome/Edge binary found')
}

/** Minimal CDP client over the page target's WebSocket. */
export class Cdp {
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
        const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
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

  /**
   * Capture the page as a PNG.
   *
   * The viewport is grown to the document's full height first, so a screenshot
   * never silently truncates the thing being verified. Pass `clip` (viewport
   * CSS pixels) to frame one region instead: a crop of a full-height column is
   * otherwise three quarters empty space, and growing the viewport first would
   * move the region being cropped.
   */
  async screenshot(file, clip) {
    if (clip !== undefined) {
      const cropped = await this.send('Page.captureScreenshot', {
        format: 'png',
        clip: { ...clip, scale: 2 },
      })
      await writeFile(file, Buffer.from(cropped.data, 'base64'))
      return { file, ...clip }
    }
    const metrics = await this.evaluate(
      `({ width: Math.max(document.documentElement.scrollWidth, window.innerWidth),
          height: Math.max(document.documentElement.scrollHeight, window.innerHeight) })`,
    )
    await this.send('Emulation.setDeviceMetricsOverride', {
      width: metrics.width,
      height: metrics.height,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await sleep(600)
    const shot = await this.send('Page.captureScreenshot', { format: 'png' })
    await writeFile(file, Buffer.from(shot.data, 'base64'))
    return { file, ...metrics }
  }
}

/**
 * Launch Chrome, attach, and hand a ready client to `body`.
 *
 * @param options.port - Remote debugging port (each probe owns its own).
 * @param options.viewport - Initial window size.
 * @param body - Receives the attached client.
 */
export async function withChrome({ port, viewport = { width: 1280, height: 900 } }, body) {
  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-probe-'))
  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      `--window-size=${viewport.width},${viewport.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  )

  let cdp
  try {
    let target
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`)
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
    return await body(cdp)
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
}

/** Report a probe's problems, deduplicated, or say there were none. */
export function reportProblems(cdp) {
  if (cdp.problems.length > 0) {
    console.log('\nPAGE PROBLEMS:')
    for (const problem of [...new Set(cdp.problems)]) console.log(`  - ${problem}`)
  } else {
    console.log('\nPAGE PROBLEMS: none')
  }
}
