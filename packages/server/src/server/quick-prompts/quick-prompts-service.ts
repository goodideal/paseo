import type { QuickPromptItem, ProjectQuickPromptsRecord } from "@getpaseo/protocol/quick-prompts";
import { QuickPromptsStore } from "./quick-prompts-store.js";

export class QuickPromptsService {
  private readonly store: QuickPromptsStore;

  constructor(paseoHome: string) {
    this.store = new QuickPromptsStore(paseoHome);
  }

  getGlobal(): QuickPromptItem[] {
    return this.store.getGlobal();
  }

  setGlobal(items: QuickPromptItem[]): void {
    this.store.setGlobal(items);
  }

  getProject(projectId: string): ProjectQuickPromptsRecord {
    return this.store.getProject(projectId);
  }

  setProject(
    projectId: string,
    input: { items?: QuickPromptItem[]; disabledGlobalIds?: string[]; order?: string[] },
  ): ProjectQuickPromptsRecord {
    return this.store.setProject(projectId, input);
  }
}
