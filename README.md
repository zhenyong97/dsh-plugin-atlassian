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

DSH 自带的 `dsh-mcp-client` 不支持 OAuth；改用 API token 则每次工具调用都要显式传 `cloudId`。
这个插件走 OAuth 2.1 补上这一段——站点由授权决定，不需要传 `cloudId`。

## 安装

```sh
dsh plugin --profile desktop add github:zhenyong97/dsh-plugin-atlassian
```

装完**重启该 profile**。把 `desktop` 换成你实际使用的 profile 名。

## 使用

1. 打开 **设置 → Atlassian**
2. 点 **连接 Atlassian**
3. 在 Atlassian 授权页**选择要授权的站点**并批准
4. 状态变为 **已连接**，工具即可使用

授权页没有自动打开时，设置页会显示一条可点击的授权链接。卡住就点 **断开连接** 再重连一次。

![设置导航里的入口](assets/settings-nav.png)

连上之后，直接对 agent 说人话就行：

- 「列出 PROJ 项目里分配给我的、还没关闭的工单」
- 「把这段需求拆成 5 个子任务，挂到 PROJ-123 下面」
- 「把这次会议的结论写成 Confluence 页面，放到 Engineering 空间」
- 「搜一下 Confluence 里带 release-notes 标签的页面，汇总成本周发布说明」

## 会用到哪些工具

授权成功后，这些工具会以 `mcp__atlassian__<名称>` 出现在 agent 的工具列表里。实际可用的集合
取决于你在授权站点里有权限访问的产品：

| 工具 | 用途 |
|---|---|
| `searchJiraIssuesUsingJql` | 用 JQL 搜索工单 |
| `getJiraIssue` | 读取单个工单 |
| `createJiraIssue` | 新建工单 |
| `getVisibleJiraProjects` | 列出可见的 Jira 项目 |
| `getTransitionsForJiraIssue` | 查看某个工单可用的状态流转 |
| `searchConfluenceUsingCql` | 用 CQL 搜索 Confluence |
| `getConfluencePage` | 读取页面内容 |
| `createConfluencePage` / `updateConfluencePage` | 新建 / 更新页面 |
| `atlassianUserInfo` | 当前授权账号 |
| `getAccessibleAtlassianResources` | 该授权可访问的站点 |

## 配置

默认配置开箱可用，通常不需要改。要改就在你 profile 的 `cordis.patch.yml` 里按 `id: atlassian`
覆盖：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `serverName` | `atlassian` | 工具名前缀：`mcp__<serverName>__<tool>` |
| `redirectPort` | `3334` | OAuth 回调端口，尽量保持不变 |
| `expectedSite` | 空 | 填了会在授权后校验站点，不一致时提示 |
| `autoOpenBrowser` | `true` | 点「连接 Atlassian」时自动打开浏览器 |

其余字段与完整默认值见 `cordis.patch.yml`。

> ⚠️ 补丁是**整体替换**该行的 `config`，不是合并，所以覆盖时其余字段也要照抄。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-plugin-atlassian
```

授权信息存在 `$DSH_HOME/.dsh-atlassian/`，一并删除即可。

## 常见问题

<details>
<summary>设置里没有 Atlassian 页</summary>

该 profile 没有 web server 服务，或插件未随 profile 重启而生效。查启动日志里 `atlassian:`
前缀的告警。
</details>

<details>
<summary>状态停在「需要授权」/ 浏览器没打开</summary>

点设置页里的授权链接直接访问。若 `redirectPort` 被占用，插件会自动退回临时端口并重新注册。
流程彻底卡住时点 **断开连接** 清掉 token 再重连。
</details>

<details>
<summary>连接成功但工具数为 0</summary>

服务端没有返回工具，通常是站点权限问题——确认授权时选中的站点里有你期望访问的产品。
</details>

<details>
<summary>提示站点不匹配</summary>

你配的 `expectedSite` 与实际授权站点不一致。工具仍可用，只是指向设置页显示的那个站点。
改掉 `expectedSite` 或重新授权即可。**这是提示，不是阻断。**
</details>

## 已知限制

- 只桥接工具，MCP 的 Resources 与 Prompts 暂不支持
- 图片结果渲染为占位文本
- 设置页的导航图标是就地补丁（DSH 没提供图标接口），匹配不上时保持默认齿轮
- 未对 `expectedSite` 不匹配做硬阻断

## 开发

```sh
npm install && npm run build   # tsc(host) + tsc(client) + 打包 client bundle
```

在独立 profile 上验证、以及两个回归脚本，见 `dev/README.md`。

## License

MIT
