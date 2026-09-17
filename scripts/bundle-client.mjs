// Wraps the compiled client program into the browser module-loader bundle.
//
// The browser does not load plain ESM: `dsh-client-modules` serves the file
// named by `exports["./client"]` straight into a page that runs it, and the
// runtime expects a CommonJS closure-factory registered on
// `window.__ModuleLoader__.load`. `tsc` already emits self-contained CommonJS
// for the single-file client program, so this script only supplies the
// wrapper — no bundler, and no `CLIENT_EXTERNALS` list to keep in sync with
// the deployment.
//
// The client program must stay ONE file with no relative imports: a relative
// `require('./x.js')` would resolve against the loader, not this package.

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const input = join(root, 'lib/client-build/index.js')
const output = join(root, 'lib/client.js')

const { name } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const body = await readFile(input, 'utf8')

const bundle = `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(name)},
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body}
\t\treturn module.exports;
\t}
});
`

await writeFile(output, bundle, 'utf8')
console.log(`bundle-client: wrote ${output} (${bundle.length} bytes)`)
