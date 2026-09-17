# dsh-plugin-atlassian

把 **Atlassian 官方远程 MCP 服务器**接入 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh)：
一次浏览器授权，Jira / Confluence / Jira Service Management / Bitbucket / Compass 的工具就会作为
原生工具出现在 agent 的工具列表里。

```
mcp__atlassian__getJiraIssue
mcp__atlassian__createJiraIssue
mcp__atlassian__searchConfluenceUsingCql
...
```

## 为什么需要这个插件

DSH 自带的 `@deepseek-ai/dsh-mcp-client` 只支持 stdio 和带静态 header 的 Streamable HTTP，
**没有 OAuth 能力**——它的传输层没有透传 `authProvider`。而 Atlassian 官方远程 MCP 推荐
OAuth 2.1。这个插件补上的正是这一段：完整的 OAuth 客户端（动态客户端注册 + PKCE + loopback 回调）
加上一个设置页。

顺带解决另一个问题：用 API token 认证时，**每一次工具调用都要显式传 `cloudId`**，
模型很容易忘。走 OAuth 则站点由授权决定，完全不需要 `cloudId`。

## 安装

```sh
dsh plugin --profile desktop add dsh-plugin-atlassian
```

安装后**重启该 profile**（bundle 层在进程内缓存）。重启后：

1. 打开 **设置 → Atlassian**
2. 点 **连接 Atlassian**（状态为「需要授权」时按钮显示为 **打开授权页**）
3. 浏览器打开 Atlassian 授权页，选择你的站点并批准
4. 回到 DSH，状态变成「已连接」，工具即可使用

> 插件启动时会在后台尝试连接，但**不会**自动弹浏览器——否则每次开 profile 都会被抢焦点。
> 需要授权时设置页会显示状态和一条可点击的授权链接，点按钮才打开浏览器。
> 如果授权流程卡住，点「断开连接」再重连即可。

授权信息（含 refresh token）保存在 `$DSH_HOME/.dsh-atlassian/`，权限 `0600`。
之后重启不需要重新授权。

## 配置

插件行来自包内的 `cordis.patch.yml`。想改配置，在你 profile 的 `cordis.patch.yml`
里按 `id` 覆盖（补丁是**整体替换**该行的 `config`，不是合并）：

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
| `expectedSite` | 空 | 预期站点。填了会在授权后校验，不一致时在设置页给明确提示 |
| `toolCallTimeoutMs` | `60000` | 单次工具调用超时 |
| `authorizationTimeoutMs` | `300000` | 等待浏览器完成授权的时间 |
| `autoOpenBrowser` | `true` | 点「连接 Atlassian」时自动打开系统浏览器。后台启动尝试**永不**弹窗 |

> ⚠️ `redirectPort` 尽量保持不变。动态客户端注册会把 redirect URI 写进注册信息，
> 端口变化会导致旧注册失效。插件会自动检测并重新注册（不会静默失败），但会多一次往返。

> 📌 `expectedSite` 在包内的 `cordis.patch.yml` 里**故意留空**。那份补丁随 npm 包一起发布，
> 是全量安装者的默认配置；在里面钉死某个真实站点，会让别人的设置页显示一条毫无来由的
> 「站点不匹配」提示。站点相关的值属于部署方，请写在你自己 profile 的 `cordis.patch.yml` 里。
>
> 另外注意 `expectedSite` 只用于**展示和事后校验**，不参与站点选择——站点永远由你在授权页上
> 的勾选决定。若一个 token 被授权了多个站点，设置页只显示资源列表里的第一个
> （`src/bridge.ts` 的 `siteFromResources`），此时这个标签仅供参考。

## 工具命名

沿用 DSH 内置 MCP 客户端的约定：

```
mcp__<serverName>__<rawName>
```

超长或含非法字符时截断到 64 字符并追加 12 位 SHA-256 哈希，因此两个不同的 MCP 工具
永远不会折叠成同一个名字。同一约定意味着会话历史与权限规则在重启后保持有效，
`dsh-context` 这类插件也能正确把它们标记为 `mcp:atlassian`。

## 已知限制

- **只桥接工具**。MCP 的 Resources 与 Prompts 没有消费机制，暂不支持。
- **图片结果渲染为占位文本**。当前只把文本块投影给模型；Jira/Confluence 的工具很少返回图片。
- **无自动重连**。Streamable HTTP 由 SDK 按请求恢复，access token 过期时 SDK 会自动用
  refresh token 续期，所以常规情况下不需要重连。连接彻底断开（如换网）时，在设置页
  点一次「重新开始授权」即可。
- **未对 `expectedSite` 不匹配做硬阻断**。只提示，不阻止使用——授权到别的站点本身是合法操作。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 设置里没有 Atlassian 页 | 该 profile 没有 web server 服务，或插件未随 profile 重启而生效。查启动日志有无 `atlassian:` 前缀的告警 |
| 状态停在「等待浏览器授权…」 | 手动点设置页里的授权链接。若 `redirectPort` 被占用，插件会退回临时端口并自动重新注册 |
| 连接后工具数为 0 | 服务端没有返回工具，通常是站点权限问题。看日志里 `atlassian: connected ... 0 tool(s)` |
| 授权后仍报未授权 | 在设置页点「断开连接」清掉 token 再重连一次 |

## 开发

```sh
npm install
npm run typecheck   # host 与 client 两套 tsc program
npm run build       # tsc(host) + tsc(client) + 包成 client bundle
```

### 结构

| 路径 | 作用 |
|---|---|
| `src/index.ts` | 插件入口（host 面）：读配置、装配 bridge、挂路由 |
| `src/bridge.ts` | MCP 连接、OAuth 交互、工具世代的原子交换 |
| `src/oauth.ts` | loopback 回调服务器 + `OAuthClientProvider` 实现 |
| `src/store.ts` | token / 客户端注册 / PKCE verifier 的持久化 |
| `src/routes.ts` | 设置页用的三个 HTTP 端点 |
| `src/client/index.tsx` | 浏览器面：设置页 |

`src/client/` 独立编译，且**必须保持单文件、无相对导入**——它会作为
`window.__ModuleLoader__.load` 的 closure-factory 被浏览器直接加载，相对 `require`
会由浏览器的模块加载器解析，而不是本包。

### 在独立 profile 上验证

不要直接拿正在用的 profile 试。`dev/` 下有现成的脚手架：

```sh
# 1. 建一个 scratch profile，并把本包链进它的 node_modules
#    （见 dev/README.md）
# 2. 先看组合树里有没有这一行（离线，不启动）
dsh --profile atlassian-dev --dump-config

# 3. 起来但不要自动开浏览器
dsh --profile atlassian-dev --patch ./dev/overlay-no-browser.yml --port 43199 --no-open

# 4. 另一个终端里看授权链路
curl http://127.0.0.1:43199/plugins/atlassian/status
```

`status` 返回里出现 `authorizationUrl`（带真实 `client_id`）就说明
动态客户端注册、PKCE、回调端口全部就绪，只差浏览器里点一下。

### 无头浏览器验证 UI

`dev/ui-probe.mjs` 用真实 Chrome（CDP，无需 playwright）打开设置面板、
点进 Atlassian 页，并断言页面渲染成功、收集控制台错误：

```sh
node dev/ui-probe.mjs "http://127.0.0.1:43199/?token=<启动时打印的 token>"
```

渲染成功退出码 0，失败退出码 1，可以直接用来把关构建。

### 回归测试：浏览器是否收到完整 URL

Windows 上 `cmd /c start` 会按 `&` 切分 URL，这是个**静默**故障——不抛错，
只是授权页少掉 `client_id`、PKCE challenge 和 state。`dev/verify-open-url.mjs`
用一个 loopback 服务器读回浏览器真实请求的请求行来守住这条：

```sh
npm run build && node dev/verify-open-url.mjs
```

（会打开一个 localhost 标签页，可随时关闭。）改动 `src/open-url.ts` 后请跑一次。

## License

MIT
