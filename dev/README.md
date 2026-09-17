# 在独立 profile 上验证本插件

**不要拿正在用的 `desktop` profile 做实验。** 下面的步骤会建一个完全独立的
`atlassian-dev` profile，插件写崩了直接删目录重来，不影响日常使用。

## 一次性准备

```powershell
$dev = "$env:USERPROFILE\.dsh\profiles\atlassian-dev"
New-Item -ItemType Directory -Force -Path "$dev\node_modules" | Out-Null
```

`package.json`（profile 的 bundle 清单）：

```json
{
  "name": "dsh-profile-atlassian-dev",
  "private": true,
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-plugin-atlassian"
      ],
      "patchReload": "live"
    }
  }
}
```

`cordis.yml` 写 `[]`（组合树由各 bundle 的补丁层叠加而成）。

把本仓库链进这个 profile 的 `node_modules`。镜像里的 profile 就是用 Junction
把依赖接进 app 安装目录的，这里沿用同一机制，因此不需要真的跑一次 pnpm 安装
（把 `<本仓库绝对路径>` 换成你 clone 下来的位置，例如 `C:\src\jira-plugins`）：

```powershell
New-Item -ItemType Junction `
  -Path "$dev\node_modules\dsh-plugin-atlassian" `
  -Target "<本仓库绝对路径>"
```

验证解析：

```powershell
node -e "console.log(require.resolve('dsh-plugin-atlassian/package.json', {paths:[process.env.USERPROFILE + '/.dsh/profiles/atlassian-dev']}))"
```

## 每次改完代码

```powershell
npm run build
```

bundle 层的包元数据在进程内缓存，所以**改了 `package.json` / `cordis.patch.yml`
必须重启**；只改 `lib/*.js` 的话，重启也一样最省事。

## 看组合树（离线，不启动）

```powershell
dsh --profile atlassian-dev --dump-config
```

输出里应出现：

```yaml
# == dsh-plugin-atlassian
- id: atlassian
  name: dsh-plugin-atlassian
  config:
    serverName: atlassian
    ...
```

## 真正启动

```powershell
dsh --profile atlassian-dev --patch ./dev/overlay-no-browser.yml --port 43199 --no-open
```

`overlay-no-browser.yml` 把 `autoOpenBrowser` 关掉，避免每次启动都弹浏览器。
要测真实的浏览器授权流程，就去掉 `--patch`。

## 探接口

```powershell
curl http://127.0.0.1:43199/plugins/atlassian/status
curl -X POST http://127.0.0.1:43199/plugins/atlassian/connect
curl -X POST http://127.0.0.1:43199/plugins/atlassian/disconnect
```

`status` 里出现带真实 `client_id` 的 `authorizationUrl`，就说明动态客户端注册、
PKCE、loopback 回调端口全部就绪——剩下的只有浏览器里点批准那一下。

## 清空授权状态

```powershell
Remove-Item "$env:USERPROFILE\.dsh\.dsh-atlassian\*.json"
```
