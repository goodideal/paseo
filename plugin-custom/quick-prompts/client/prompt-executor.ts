import type { PaseoApi } from "@getpaseo/client";
import type { ComposerApi } from "@getpaseo/plugin/client";
import type { QuickPromptItem } from "../shared/contracts.js";

export interface ExecuteQuickPromptOptions {
  item: QuickPromptItem;
  agentId: string | null;
  paseo: PaseoApi | null;
  composerApi: ComposerApi;
  availableModelIds?: readonly string[];
  onToastError?: (message: string) => void;
}

export async function executeQuickPrompt(options: ExecuteQuickPromptOptions): Promise<boolean> {
  const { item, agentId, paseo, composerApi, availableModelIds, onToastError } = options;

  const targetModelId = item.targetModelId?.trim();
  if (!targetModelId) {
    composerApi.submitText(item.content);
    return true;
  }

  if (!agentId || !paseo?.agents) {
    onToastError?.("无法在当前 Agent 上设置模型，已停止发送 / Cannot set model, prompt not sent");
    return false;
  }

  if (
    availableModelIds &&
    availableModelIds.length > 0 &&
    !availableModelIds.includes(targetModelId)
  ) {
    onToastError?.(
      "目标模型在当前 Provider 不可用，已停止发送 / Model unavailable, prompt not sent",
    );
    return false;
  }

  try {
    await paseo.agents.ref(agentId).setModel(targetModelId);
  } catch (error) {
    onToastError?.("模型切换失败，已停止发送 / Failed to switch model, prompt not sent");
    return false;
  }

  composerApi.submitText(item.content);
  return true;
}
