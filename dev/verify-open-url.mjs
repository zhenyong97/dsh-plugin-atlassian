// Regression test for the Windows URL-opening bug.
//
// The bug was silent: `cmd /c start "" <url>` splits the URL at the first `&`,
// so the browser landed on `?response_type=code` alone while cmd tried to run
// `client_id=...` as a command. Nothing threw — the user just got a broken
// authorize page. A loopback server is the only way to observe what the
// browser actually received.
//
// ⚠️ This opens a real browser tab (a local page that says so). Run it after
// touching `src/open-url.ts`, or on a new Windows host.
//
//   npm run build && node dev/verify-open-url.mjs
//
// Exit code 0 means the URL arrived intact.

import { createServer } from 'node:http'
import { openInBrowser } from '../lib/open-url.js'

const QUERY =
  '?response_type=code&client_id=9PKbNt6a4axEny2r&code_challenge=abc-123_XYZ' +
  '&code_challenge_method=S256&redirect_uri=http%3A%2F%2F127.0.0.1%3A3334%2Fcallback' +
  '&state=1906b7b1ab53989d70ae6250a53dfcb5'

let resolveRequest
const requestSeen = new Promise((resolve) => {
  resolveRequest = resolve
})

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(
    '<!doctype html><meta charset="utf-8"><title>probe</title>' +
      '<body style="font:16px/1.6 system-ui;margin:12vh auto;max-width:34rem;text-align:center">' +
      '<h1 style="font-size:1.3rem">URL 完整性探针</h1>' +
      '<p>openInBrowser 传递的 URL 完整。</p>' +
      '<p style="color:#888;font-size:.85rem">这个标签页可以关闭。</p></body>',
  )
  resolveRequest(req.url)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

console.log('期望浏览器请求的 path+query:')
console.log(`  /probe${QUERY}\n`)
const opened = await openInBrowser(`http://127.0.0.1:${port}/probe${QUERY}`)
console.log(`openInBrowser 返回: ${opened}`)

const actual = await Promise.race([
  requestSeen,
  new Promise((resolve) => setTimeout(() => resolve(undefined), 30_000)),
])
server.close()

if (actual === undefined) {
  console.log('\nRESULT: 30 秒内没有收到浏览器请求（默认浏览器可能未启动）')
  process.exitCode = 1
} else {
  console.log(`浏览器实际请求: ${actual}`)
  const intact = actual === `/probe${QUERY}`
  console.log(`RESULT: URL ${intact ? '完整' : '被截断或篡改'}`)
  if (!intact) {
    const expected = new URL(`http://x${QUERY}`)
    const got = new URL(`http://x${actual}`)
    for (const [key, value] of expected.searchParams) {
      const received = got.searchParams.get(key)
      if (received !== value) console.log(`  丢失/不符: ${key} = ${String(received)}（期望 ${value}）`)
    }
  }
  process.exitCode = intact ? 0 : 1
}
