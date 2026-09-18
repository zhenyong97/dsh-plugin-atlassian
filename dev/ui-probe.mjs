// Headless UI probe for the Settings → Atlassian page.
//
// Answers the one question a host-side check cannot: does the page actually
// appear and render? The board panel has its own probe (`board-probe.mjs`).
//
//   node dev/ui-probe.mjs "http://127.0.0.1:43199/?token=..."
//
// Exits non-zero when the Atlassian entry is not found, so it can gate a build.

import { sleep, withChrome, reportProblems } from './cdp.mjs'

const url = process.argv[2]
if (url === undefined) {
  console.error('usage: node dev/ui-probe.mjs "<url with token>"')
  process.exit(2)
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

await withChrome({ port: 9222 }, async (cdp) => {
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
  console.log('→ clicked Atlassian entry:', await cdp.evaluate(clickAtlassian))
  await sleep(2500)

  const panel = await cdp.evaluate(`document.body.innerText`)
  console.log('===== PAGE TEXT =====')
  console.log(panel)
  console.log('=====================')

  // Assert on the page's own copy, not on a button label: the connect button
  // reads differently depending on connection state, and asserting on it made
  // an earlier run report NOT RENDERED for a page that had rendered fine.
  // The header subtitle plus a row label are unique to this page and stable
  // across connection states.
  const found = typeof panel === 'string' && panel.includes('官方远程 MCP 服务器') && panel.includes('可用工具')
  check('settings page rendered', found === true)
  reportProblems(cdp)
})

console.log(failures === 0 ? '\nRESULT: Atlassian settings page RENDERED' : `\nRESULT: ${String(failures)} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
