# OMP Chat — VS Code 扩展

在 VS Code 里使用 [Oh My Pi](https://github.com/badlogic/pi-mono)（omp）编程智能体。 **复用 omp-web 的 React UI**（组件原样拷贝进 webview）+ HTTP/SSE 桥接本地 omp-web 服务，服务端**零改动**。

## 架构

```
┌──────────────────────────────────────────────────────────┐
│ VS Code 扩展 (extension host, Node)                       │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │ 侧边栏 WebviewView（Copilot Chat 式）               │  │
│  │                                                     │  │
│  │  ┌───────────────────────────────────────────────┐  │  │
│  │  │ omp-web React 应用（AppShell 组件原样拷贝）     │  │  │
│  │  │ ChatWindow / ChatInput / MessageView / …       │  │  │
│  │  │ useAgentSession（SSE 状态机原样复用）           │  │  │
│  │  └──────────────────┬────────────────────────────┘  │  │
│  │                     │ fetch/EventSource 被 monkey-  │  │
│  │  ┌──────────────────▼────────────────────────────┐  │  │
│  │  │ bridge.ts（window.fetch / EventSource 替换）   │  │  │
│  │  │ → postMessage                                 │  │  │
│  │  └───────────────────────────────────────────────┘  │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             │ postMessage                 │
│  ┌──────────────────────────▼──────────────────────────┐  │
│  │ ChatProvider（桥接）                                 │  │
│  │  ├─ /api/* 请求 → omp-web（rawRequest 代理）         │  │
│  │  ├─ SSE 事件流转发（无限重连）                        │  │
│  │  └─ 服务生命周期（检测/启动/停止）                    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────┬────────────────────────────┘
                               │ 零改动
                  ┌─────────────▼─────────────┐
                  │  omp-web (Next.js 本地服务) │
                  │  127.0.0.1:30141          │
                  └───────────────────────────┘
```

**为什么所有请求都放在扩展宿主？** omp-web 没有 CORS 头，webview 直接 fetch 会跨域失败。所以在 webview 里 monkey-patch `window.fetch` 和 `window.EventSource`，把 `/api/*` 请求转发到扩展宿主，由宿主代理到本地服务。React 组件代码零改动。

## 已复用 / 已裁剪

- ✅ **复用（原样拷贝到 `src/ui/omp/`）**：AppShell、SessionSidebar、ChatWindow、ChatInput、MessageView、MarkdownBody、ModelsConfig、SkillsConfig、useAgentSession、全部 lib
- ❌ **裁剪**：FileExplorer、FileViewer（VS Code 自带文件浏览/打开）、ChatMinimap（侧边栏用不上）
- 🔧 **适配**：`next/navigation` mock、`os`/`path` 浏览器 shim、Tailwind v4 独立编译、CSS module 移除

## 功能（继承 omp-web 全部 UI 能力）

- ✅ 聊天面板：流式输出、thinking 折叠、工具调用卡片、shell 执行（`!cmd`）、拖拽图片
- ✅ 会话管理：会话侧边栏、历史会话、Fork/分支、worktree 跟随
- ✅ 模型配置：模型列表/登录/API key/测试（ModelsConfig 原样复用）
- ✅ Skills：搜索、安装、启停
- ✅ 服务生命周期：检测已有 omp-web 直接连接；未运行则自动 `npx omp-web` 启动；退出时可选择关闭由本扩展启动的进程
- ✅ 状态栏：显示 agent 运行状态

## 开发

```bash
pnpm install
pnpm build        # 或 pnpm watch（增量）
```

按 F5（或 `Run Extension`）打开 Extension Development Host。

**前置条件**：本地已安装/可启动 omp-web（默认 `npx -y omp-web@latest --no-open`），系统 `PATH` 里的 Node 需 ≥ 22.19（omp-web 的要求）。

## 配置

| 设置 | 默认 | 说明 |
| --- | --- | --- |
| `omp.server.port` | `30141` | omp-web 服务端口 |
| `omp.server.autoStart` | `true` | 激活时自动启动服务 |
| `omp.server.command` | `npx -y omp-web@latest --no-open` | 启动命令 |
| `omp.server.stopOnExit` | `true` | 退出 VS Code 时停止本扩展启动的进程 |

## 命令

| 命令                     | 说明                |
| ------------------------ | ------------------- |
| `OMP: Open Chat`         | 打开/聚焦侧边栏聊天 |
| `OMP: Refresh Sessions`  | 刷新会话树          |
| `OMP: Open Session`      | 选择并打开历史会话  |
| `OMP: Start/Stop Server` | 手动管理服务        |

## Webview 通信协议

```
webview → extension:  api (fetch 代理) | events (SSE 订阅) | eventsClose | startServer
extension → webview:  apiResponse | event (AgentEvent) | serverReady
```

`/api/*` 的 fetch 和 EventSource 在 `src/ui/bridge.ts` 里被 monkey-patch：webview 里的 omp-web 组件**一行未改**，所有请求经 postMessage 到扩展宿主代理。事件流（`AgentEvent`）与 omp-web 完全一致：`agent_start`、`message_start/update/end`、 `tool_execution_start/end`、`agent_settled`、`prompt_done/error`、`queue_update` 等。

## 与 omp-web 的关系

| 层 | 复用 | 新增/适配 |
| --- | --- | --- |
| 服务端 | ✅ 100% 复用（`lib/rpc-manager.ts`、`session-reader`、models、worktree…） | 无 |
| 协议 | ✅ `AgentEvent` / 命令类型原样 | fetch/EventSource 桥（`src/ui/bridge.ts`） |
| 前端 | ✅ 组件原样拷贝到 `src/ui/omp/`（AppShell 等 74 个文件） | `next/navigation` mock、`os`/`path` shim、Tailwind 编译 |
| 集成 | — | 服务生命周期、会话树、状态栏、CSP/打包 |

## Roadmap

- [ ] 编辑器联动：点击文件/代码位置在 VS Code 打开（桥接 postMessage → `showTextDocument`）
- [ ] 会话树点击 → 导航内嵌应用到对应会话（URL 状态桥）
- [ ] diff 视图、终端联动
- [ ] webview.js 体积优化（mermaid 懒加载，当前 ~5.6MB minify）
