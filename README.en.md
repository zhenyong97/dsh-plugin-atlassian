# dsh-plugin-atlassian

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文](README.md) · **English**

Bridges **Atlassian's official remote MCP server** into
[DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh). After a single browser
authorization, the Jira, Confluence, Jira Service Management, Bitbucket and Compass tools appear as
native tools in the agent's tool list:

```
mcp__atlassian__getJiraIssue
mcp__atlassian__createJiraIssue
mcp__atlassian__searchConfluenceUsingCql
```

![Settings → Atlassian](assets/settings-page.png)

The DSH built-in `dsh-mcp-client` has no OAuth support, and API-token auth forces an explicit
`cloudId` on every tool call. This plugin supplies the missing piece over OAuth 2.1 — the site
follows from the authorization, so no `cloudId` is ever passed.

## Install

```sh
dsh plugin --profile desktop add github:zhenyong97/dsh-plugin-atlassian
```

**Restart that profile afterwards.** Replace `desktop` with the profile you actually use.

## Usage

1. Open **Settings → Atlassian**
2. Click **Connect Atlassian**
3. Approve the request on Atlassian's authorization page, **choosing the site to authorize**
4. The status becomes **Connected** and the tools are available

If the page does not open by itself, Settings shows a clickable authorization link. If the flow
gets stuck, click **Disconnect** and reconnect.

## Configuration

The defaults work out of the box. To change one, override by `id: atlassian` in your profile's
`cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `serverName` | `atlassian` | Tool-name prefix: `mcp__<serverName>__<tool>` |
| `redirectPort` | `3334` | OAuth callback port — keep it stable |
| `expectedSite` | empty | When set, the authorized site is checked and a mismatch reported |
| `autoOpenBrowser` | `true` | Open the browser when **Connect Atlassian** is clicked |

Remaining fields and the full defaults are in `cordis.patch.yml`.

> ⚠️ A patch **replaces the row's whole `config`** rather than merging, so restate the other
> fields when you override.

## Uninstall

```sh
dsh plugin --profile desktop remove dsh-plugin-atlassian
```

The stored authorization lives in `$DSH_HOME/.dsh-atlassian/` — delete it too.

## Troubleshooting

<details>
<summary>No Atlassian page in Settings</summary>

The profile has no web server service, or the plugin did not take effect with the profile restart.
Look for warnings prefixed with `atlassian:` in the startup log.
</details>

<details>
<summary>Stuck at "Authorization required" / the browser never opened</summary>

Use the authorization link shown in Settings. If `redirectPort` is taken, the plugin falls back to
a temporary port and re-registers automatically. If the flow is truly stuck, click **Disconnect**
to clear the token and reconnect.
</details>

<details>
<summary>Connected, but the tool count is 0</summary>

The server returned no tools, usually a site permission issue — confirm the site you authorized
gives access to the products you expect.
</details>

<details>
<summary>Settings reports a site mismatch</summary>

The `expectedSite` you configured does not match the site actually authorized. The tools still
work; they just point at the site Settings shows. Fix `expectedSite` or re-authorize. **This is a
notice, not a block.**
</details>

## Known limitations

- Tools only — MCP Resources and Prompts are not supported yet
- Image results render as placeholder text
- The Settings nav icon is patched in place (DSH exposes no icon interface); if the patch does not
  match, the default gear stays
- A `expectedSite` mismatch is not a hard block

## Development

```sh
npm install && npm run build   # tsc(host) + tsc(client) + bundle the client
```

Verifying on a scratch profile, plus the two regression scripts, is covered in `dev/README.md`.

## License

MIT
