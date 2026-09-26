## 1. 插件工程骨架与共享类型 (Plugin Scaffold & Shared Contracts)

- [x] 1.1 初始化 `plugins/subagent-watchdog` 目录结构与 `paseo-plugin.json`、`package.json`、`tsconfig.json`，验证插件清单符合规范
- [x] 1.2 编写 `shared/types.ts` 和 `shared/rpc.ts` 定义阻断状态、意图模型与决策 RPC 强类型契约，验证 `tsc --noEmit` 通过

## 2. 服务端核心监控与调控逻辑 (Server Watchdog & Governor)

- [x] 2.1 实现 `server/stream-watcher.ts`，监听长耗时工具调用，编写测试验证超过 15 秒触发进度状态分发
- [x] 2.2 实现 `server/managed-governor.ts`，处理安全命令自动放行、未完结意图续推及 5 轮上限熔断，编写测试验证调控与防震荡逻辑
- [x] 2.3 实现 `server/synthesizer.ts` 与 `server/executor.ts`，生成结构化决策卡片并通过 RPC 响应用户操作，编写测试验证卡片生成与动作执行
- [x] 2.4 实现 `index.server.ts` 整合生命周期事件、注册 RPC 与全局事件订阅，编写测试验证插件加载与生命周期监听

## 3. 客户端 Timeline 决策卡片与交互组件 (Client Decision Card & UI)

- [x] 3.1 编写 `client/components/decision-card.tsx` 与 `action-buttons.tsx`，严格规避 `useUnistyles()` 并遵循 `docs/hover.md` 规范，验证跨端样式与类型
- [x] 3.2 编写 `client/components/in-flight-pill.tsx` 与 `client/hooks/use-decision-rpc.ts`，实现心跳胶囊渲染与 RPC 单向数据流调用
- [x] 3.3 编写 `index.client.tsx` 注册 Timeline 渲染贡献，验证客户端模块打包与类型检查通过

## 4. 全链路集成与测试验证 (Integration & Verification)

- [x] 4.1 编写集成测试套件验证完整链路：模拟长耗时 Tool-call 心跳、安全命令自动放行、报错阻断生成决策卡片及按钮点击恢复
- [x] 4.2 执行语法、格式与类型检查（`npm run lint` 与 `npm run format:check`），确保工程质量符合规范
