import type { PaseoApi } from "@getpaseo/client";
import type { QuickPromptItem } from "../shared/contracts.js";

export interface ExecuteQuickPromptOptions {
  item: QuickPromptItem;
  agentId: string | null;
  paseo: PaseoApi | null;
  availableModelIds?: readonly string[];
  onToastError?: (message: string) => void;
  onSendText?: (text: string) => void | Promise<void>;
}

export async function executeQuickPrompt(options: ExecuteQuickPromptOptions): Promise<boolean> {
  const { item, agentId, paseo, availableModelIds, onToastError, onSendText } = options;

  if (!agentId || !paseo?.agents) {
    if (onSendText) {
      await onSendText(item.content);
      return true;
    }
    onToastError?.("无法定位当前 Agent，已停止发送 / Cannot resolve agent, prompt not sent");
    return false;
  }

  const targetModelId = item.targetModelId?.trim();
  if (targetModelId) {
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
    } catch {
      onToastError?.("模型切换失败，已停止发送 / Failed to switch model, prompt not sent");
      return false;
    }
  }

  if (onSendText) {
    await onSendText(item.content);
  } else {
    await paseo.agents.ref(agentId).send(item.content);
  }
  return true;
}
