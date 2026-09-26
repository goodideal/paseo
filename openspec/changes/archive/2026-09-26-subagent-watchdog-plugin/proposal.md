## Why

在多代理协作（Multi-agent Orchestration）与子代理驱动开发（Subagent-Driven Development）中，用户经常遭遇会话在长耗时工具调用（如 `wait_agent`）时陷入无心跳的假死黑盒、安全命令或阶段性任务结束后频繁停滞等待人工点击“继续”、以及已完成子会话未释放导致并发撞墙（`thread limit reached`）等问题。

通过引入一个非侵入式的 `subagent-watchdog` 插件，在服务端提供长耗时 Tool-call 进度心跳与安全操作自动续跑，在客户端提供交互式阻断决策卡片与快捷按钮，实现多代理任务端到端自主推进，同时在关键分叉口给用户清晰决策支撑。

## What Changes

- 新增 `plugins/subagent-watchdog` 独立扩展插件：
  - **In-flight Stream 心跳侦测 (Stream Watcher)**：实时侦测超过 15 秒的长耗时工具调用并向前端推送进度状态与耗时心跳，破除假死黑盒；
  - **双轨子代理调控器 (Dual-Track Governor)**：
    - 对 Paseo 托管子代理：安全命令（`git status`、`test` 等）自动放行权限，单任务连续续跑配额控制（默认 5 轮防死循环）；
    - 对 Provider 原生代理（如 Codex `spawn_agent`）：注入结构化阻断上报工具与并发超限（`thread limit reached`）时的会话回收提示；
  - **阻断决策卡片与交互按钮 (Interactive Blocker Card)**：发生真实错误或疑问时，在 Timeline 渲染结构化决策卡片，提供快捷按钮一键执行决策；
  - **合规跨端 UI 实现**：严格禁止 `useUnistyles()`，遵循 `docs/hover.md` 规范实现移动端与桌面端自适应。

## Capabilities

### New Capabilities

- `subagent-watchdog`: 涵盖子代理长耗时运行心跳侦测、安全操作启发式自动推进、以及阻断时的结构化决策卡片交互。

### Modified Capabilities

（无现有需求规格变更）

## Impact

- **新增代码路径**：`plugins/subagent-watchdog/`（服务端守护逻辑与客户端 Timeline 卡片渲染）；
- **Paseo 核心源码**：零修改、零侵入；
- **依赖影响**：使用 `@getpaseo/plugin` 和 `@getpaseo/client` 现有开放 API。
