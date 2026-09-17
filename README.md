# dsh-plugin-atlassian

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**中文** · [English](README.en.md)

把 **Atlassian 官方远程 MCP 服务器**接入 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)。
一次浏览器授权后，Jira、Confluence、Jira Service Management、Bitbucket 与 Compass 的工具会作为
原生工具出现在 agent 的工具列表里：

```
mcp__atlassian__getJiraIssue
mcp__atlassian__createJiraIssue
mcp__atlassian__searchConfluenceUsingCql
```

![设置 → Atlassian](assets/settings-page.png)

## 功能

- 🔐 **OAuth 2.1 授权** —— 动态客户端注册 + PKCE + loopback 回调。授权信息（含 refresh token）
  保存在 `$DSH_HOME/.dsh-atlassian/`，权限 `0600`，重启不需要重新授权
- 🚫 **不需要 `cloudId`** —— 站点由授权决定，每次工具调用都不必显式传 `cloudId`
- 🖥️ **设置页** —— 显示连接状态、当前授权站点与可用工具数，提供「连接 / 断开连接」以及手动授权链接
- 🧩 **工具名沿用内置约定** —— `mcp__<serverName>__<rawName>`，会话历史与权限规则在重启后保持有效
- 🔍 **站点校验（可选）** —— 配置 `expectedSite` 后，授权完成时比对实际站点，不一致会在设置页提示
- 🙈 **后台启动不弹浏览器** —— profile 启动时的连接尝试不会抢焦点

## 安装

```sh
dsh plugin --profile desktop add dsh-plugin-atlassian
```

**装完重启该 profile**（bundle 层在进程内缓存）。把 `desktop` 换成你实际使用的 profile 名。

<details>
<summary>从本地目录安装（尚未发布 npm 时）</summary>

把本仓库链接进目标 profile 的 `node_modules`：

```powershell
$profileDir = "$env:USERPROFILE\.dsh\profiles\desktop"

New-Item -ItemType Junction `
  -Path "$profileDir\node_modules\dsh-plugin-atlassian" `
  -Target "<本仓库绝对路径>"
```

再在 profile 的 `cordis.patch.yml` 里确认插件行已生效，然后重启 profile。

> 克隆后需要先构建：`npm install && npm run build`。若通过 `dsh plugin add` 从 git 安装，
> 包内的 `prepare` 脚本会自动构建，不需要手动执行。

</details>

## 使用

1. 打开 **设置 → Atlassian**
2. 点 **连接 Atlassian**（当前需要授权时按钮显示为 **打开授权页**）
3. 浏览器打开 Atlassian 授权页，**选择要授权的站点**并批准
4. 回到 DSH，状态变为 **已连接**，工具即可使用

> 站点完全由你在授权页上的勾选决定，插件不预设、也不替你选择站点。
> 授权页若没有自动打开，设置页会显示一条可点击的授权链接。
> 流程卡住时，点 **断开连接** 清掉 token 再重连一次。

## 配置

插件行来自包内的 `cordis.patch.yml`。想改配置，在你 profile 的 `cordis.patch.yml` 里按 `id` 覆盖
（补丁是**整体替换**该行的 `config`，不是合并，所以其余字段也要照抄）：

```yaml
- id: atlassian
  config:
    serverName: atlassian
    url: https://mcp.atlassian.com/v1/mcp
    redirectPort: 3334
    expectedSite: your-site.atlassian.net
    toolCallTimeoutMs: 60000
    authorizationTimeoutMs: 300000
    autoOpenBrowser: true
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `serverName` | `atlassian` | 工具名前缀：`mcp__<serverName>__<tool>` |
| `url` | `https://mcp.atlassian.com/v1/mcp` | 远程 MCP 端点（旧 `/v1/sse` 已弃用） |
| `redirectPort` | `3334` | OAuth 回调的 loopback 端口；`0` 表示由系统分配 |
| `expectedSite` | 空 | 预期站点。填了会在授权后校验，不一致时在设置页提示 |
| `toolCallTimeoutMs` | `60000` | 单次工具调用超时 |
| `authorizationTimeoutMs` | `300000` | 等待浏览器完成授权的时间 |
| `autoOpenBrowser` | `true` | 点「连接 Atlassian」时自动打开浏览器。后台启动尝试**永不**弹窗 |

> ⚠️ `redirectPort` 尽量保持不变。动态客户端注册会把 redirect URI 写进注册信息，端口变化会导致
> 旧注册失效。插件会自动检测并重新注册（不会静默失败），但会多一次往返。

> 📌 `expectedSite` 在包内的 `cordis.patch.yml` 里**故意留空**。那份补丁随 npm 包一起发布，是
> 所有安装者的默认配置；在里面钉死某个真实站点会让别人的设置页显示一条毫无来由的「站点不匹配」
> 提示。站点相关的值属于部署方，请写在你自己 profile 的 `cordis.patch.yml` 里。
>
> `expectedSite` 只用于**展示和事后校验**，不参与站点选择。若一个 token 被授权了多个站点，
> 设置页只显示资源列表里的第一个，此时这个标签仅供参考。

## 工具命名

沿用 DSH 内置 MCP 客户端的约定：

```
mcp__<serverName>__<rawName>
```

超长或含非法字符时截断到 64 字符并追加 12 位 SHA-256 哈希，因此两个不同的 MCP 工具永远不会
折叠成同一个名字。同一约定意味着会话历史与权限规则在重启后保持有效，`dsh-context` 这类插件
也能正确把它们标记为 `mcp:atlassian`。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-plugin-atlassian
```

再删掉授权信息：`Remove-Item "$env:USERPROFILE\.dsh\.dsh-atlassian\*.json"`。

## 常见问题

<details>
<summary>设置里没有 Atlassian 页</summary>

该 profile 没有 web server 服务，或插件未随 profile 重启而生效。查启动日志里有没有
`atlassian:` 前缀的告警。`dsh --profile <name> --dump-config` 可以看到组合树里是否真的有这一行。
</details>

<details>
<summary>状态停在「需要授权」不动 / 浏览器没打开</summary>

设置页会显示一条可点击的授权链接，直接点它即可。若 `redirectPort` 被别的程序占用，插件会退回
临时端口并自动重新注册。授权流程彻底卡住时，点 **断开连接** 清掉 token 再重连。
</details>

<details>
<summary>连接成功但工具数为 0</summary>

服务端没有返回工具，通常是站点权限问题。看日志里 `atlassian: connected ... 0 tool(s)`。
确认授权时选中的站点里有你期望访问的产品。
</details>

<details>
<summary>授权后仍报未授权</summary>

在设置页点 **断开连接** 清掉 token，再重新连接一次。
</details>

<details>
<summary>设置页提示站点不匹配</summary>

你在 profile 里配的 `expectedSite` 与实际授权的站点不一致。工具仍然可用，但它们指向的是设置页
显示的那个站点。改掉 `expectedSite` 或重新授权到预期站点即可。**这是提示，不是阻断。**
</details>

## 已知限制

- **只桥接工具**。MCP 的 Resources 与 Prompts 没有消费机制，暂不支持。
- **图片结果渲染为占位文本**。当前只把文本块投影给模型；Jira / Confluence 的工具很少返回图片。
- **无自动重连**。Streamable HTTP 由 SDK 按请求恢复，access token 过期时 SDK 会自动用 refresh
  token 续期，常规情况下不需要重连。连接彻底断开（如换网）时，在设置页重连一次即可。
- **未对 `expectedSite` 不匹配做硬阻断**。只提示，不阻止使用——授权到别的站点本身是合法操作。
- **设置导航图标是就地补丁，不是受支持的接口**。外壳按分区 id 硬编码导航图标（未知 id 一律
  回退成通用齿轮），而 `settings.section` 只接受 `id`/`order`/`label`——整个客户端契约里没有
  任何槽位支持图标。插件只能在自己的导航行上把那个 SVG 换掉：

  ![导航图标](assets/settings-nav.png)

  这是尽力而为的：匹配不上（比如外壳改了标记）时只会保留原来的齿轮，不影响任何功能。

## 架构与实现细节

<details>
<summary>点击展开</summary>

插件在组合树上占一行（`id: atlassian`），分为 host 与 client 两面：

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 插件入口（host 面）：读配置、装配 bridge、挂路由 |
| `src/bridge.ts` | MCP 连接、OAuth 交互、工具世代的原子交换、站点探测 |
| `src/oauth.ts` | loopback 回调服务器 + `OAuthClientProvider` 实现 |
| `src/store.ts` | token / 客户端注册 / PKCE verifier 的持久化 |
| `src/routes.ts` | 设置页用的三个 HTTP 端点（`status` / `connect` / `disconnect`） |
| `src/open-url.ts` | 跨平台打开系统浏览器 |
| `src/client/index.tsx` | 浏览器面：设置页 |

**工具注册是世代制的**：发现过程先构建完整的新一代工具集，只有全部成功才替换，因此一次失败的
重新同步不会让上一代工具失效。

**为什么需要这个插件**：DSH 自带的 `@deepseek-ai/dsh-mcp-client` 只支持 stdio 与带静态 header 的
Streamable HTTP，传输层没有透传 `authProvider`，**没有 OAuth 能力**。而 Atlassian 官方远程 MCP
推荐 OAuth 2.1。这个插件补上的正是这一段。顺带解决了 API token 认证下每次调用都要显式传
`cloudId` 的问题——走 OAuth 则站点由授权决定。

**站点探测**：授权服务器不会把用户选的站点写进 token，因此插件在连上之后调用一次
`getAccessibleAtlassianResources` 工具，从返回的 `url` 里解析主机名。这一步是尽力而为的，
失败只会少一个站点标签，不影响连接。

**client 面的约束**：`src/client/` 独立编译（`tsconfig.client.json`），且**必须保持单文件、
无相对导入**——它会作为 `window.__ModuleLoader__.load` 的 closure-factory 被浏览器直接加载，
相对 `require` 会由浏览器的模块加载器解析，而不是本包。

</details>

## 开发

```sh
npm install
npm run typecheck   # host 与 client 两套 tsc program
npm run build       # tsc(host) + tsc(client) + 包成 client bundle
```

<details>
<summary>在独立 profile 上验证</summary>

不要直接拿正在用的 profile 试。`dev/` 下有现成的脚手架，步骤见 `dev/README.md`：

```sh
# 先看组合树里有没有这一行（离线，不启动）
dsh --profile atlassian-dev --dump-config

# 起来但不要自动开浏览器
dsh --profile atlassian-dev --patch ./dev/overlay-no-browser.yml --port 43199 --no-open

# 另一个终端里看授权链路
curl http://127.0.0.1:43199/plugins/atlassian/status
```

`status` 返回里出现 `authorizationUrl`（带真实 `client_id`）就说明动态客户端注册、PKCE、
回调端口全部就绪，只差浏览器里点一下。

两个回归脚本：

- `dev/ui-probe.mjs` —— 用真实 Chrome（CDP，无需 playwright）打开设置面板并断言渲染成功、收集控制台错误；退出码 0/1 可直接把关构建
- `dev/verify-open-url.mjs` —— 守住 Windows 上 `cmd /c start` 会按 `&` 切分 URL 的**静默**故障（授权页会少掉 `client_id`、PKCE challenge 与 state）。改动 `src/open-url.ts` 后请跑一次

</details>

## License

MIT
