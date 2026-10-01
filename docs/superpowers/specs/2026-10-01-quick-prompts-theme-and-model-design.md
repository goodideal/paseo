# Quick Prompts 主题与目标模型设计规格

## 目标

修复 Quick Prompts 在 Paseo 浅色主题中的低对比度按钮，并允许用户为每个 Quick Prompt 选择可选的目标模型。设置目标模型的 Prompt 被点击时，先切换当前 Agent 的模型，成功后再发送 Prompt；未设置时保持现有发送行为。

成功标准：浅色主题中所有 Quick Prompt 文本和状态清晰可辨；模型切换失败时不发送 Prompt；未配置模型和历史存储记录继续可用。

## 范围与非目标

修改范围包括 `plugin-custom/quick-prompts`、Plugin Composer API 与 `@getpaseo/client` 的公开 Agent Handle。模型目录继续使用现有 Provider API。

不支持跨 Provider 切换，不将模型作为显示规则，也不改变长按编辑行为。长按仅将 Prompt 写入 Composer，不切换模型。不会新增 Daemon RPC 或改变 Wire Protocol。

## 浅色主题

Quick Prompt Chip 仅使用语义主题 Token。普通 Chip 的文字使用 `foreground`，边框使用 `border`。规则和动态 Chip 的文字、图标和边框使用 `accent`，不再使用仅适用于强调色填充背景的 `accentForeground`。

默认背景使用 `surface2`，悬停和按压使用 `surface3`。`PluginTheme` 补充 `surface3`，由应用主题映射传入。浅色模式的交互状态因此比默认背景更深，深色模式维持现有层级。

## 模型配置与持久化

`QuickPromptItem` 增加可选 `targetModelId?: string`。字段只存储 Provider 内模型 ID，不存 Provider；Prompt 的执行目标始终是当前 Agent，不能借此切换 Provider。

字段保持可选，所有 Quick Prompt RPC 与 JSON 记录兼容历史数据。保存时将空白值规范化为省略字段；默认内置 Prompt 不设置目标模型。

编辑弹窗从当前 Agent 的 Provider 模型目录读取可选项。创建或编辑时显示“执行模型（可选）”：`使用当前模型` 代表未设置；其余选项显示模型 Label 并保存模型 ID。模型目录未加载或没有当前 Agent 时禁用该控件并说明原因。

全局 Prompt 可以配置模型；当它在不同 Provider 的 Agent 中使用时，执行前重新验证目标模型是否存在于当前 Provider 的可选模型中。

## 宿主 API 与执行流

`PaseoAgentHandle` 增加 `setModel(modelId: string | null): Promise<void>`，作为现有 Daemon Client `setAgentModel` 的受控公开包装。插件通过 `paseo.agents.ref(agentId)` 取得 Handle，不能接触 `DaemonClient`。

点击 Quick Prompt 的流程：

1. 无 `targetModelId` 时，直接调用现有 `composerApi.submitText`。
2. 有 `targetModelId` 时，读取当前 Provider 的模型目录并确认该 ID 可用。
3. 不可用时显示错误 Toast 并停止，不提交 Prompt。
4. 可用时调用 `await paseo.agents.ref(agentId).setModel(targetModelId)`。
5. 设置成功后调用 `composerApi.submitText(item.content)`；设置失败时显示错误 Toast 并停止。

模型目录请求或模型设置期间，Quick Prompt Bar 禁用重复点击。失败不尝试回滚：设置调用要么被 Daemon 拒绝，要么已成功；模型设置成功后的消息提交沿用 Composer 既有错误处理。

## 测试与验证

- 为 `targetModelId` 添加 Schema 兼容性测试，确认历史记录和新字段均可解析。
- 为 `PaseoAgentHandle.setModel` 添加 Client 包装测试。
- 将 Quick Prompt 执行提取为可测试流程：验证无目标模型直接发送、先设置后发送、模型不支持和设置失败均不发送。
- 为 Chip 主题样式添加浅色 Token 回归测试，确认规则/动态 Chip 不使用 `accentForeground`，Hover 使用 `surface3`。
- 运行受影响的 Vitest 文件、`npm run typecheck`、`npm run lint`；变更完成后运行 `npm run format`。
