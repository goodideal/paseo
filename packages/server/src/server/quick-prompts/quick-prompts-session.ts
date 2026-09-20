import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { QuickPromptsService } from "./quick-prompts-service.js";

export class QuickPromptsSession {
  private readonly service: QuickPromptsService;
  private readonly emit: (msg: SessionOutboundMessage) => void;

  constructor(paseoHome: string, emit: (msg: SessionOutboundMessage) => void) {
    this.service = new QuickPromptsService(paseoHome);
    this.emit = emit;
  }

  handleGlobalGet(
    request: Extract<SessionInboundMessage, { type: "quick_prompts.global.get.request" }>,
  ): void {
    const items = this.service.getGlobal();
    this.emit({
      type: "quick_prompts.global.get.response",
      payload: {
        requestId: request.requestId,
        items,
      },
    });
  }

  handleGlobalSet(
    request: Extract<SessionInboundMessage, { type: "quick_prompts.global.set.request" }>,
  ): void {
    this.service.setGlobal(request.items);
    this.emit({
      type: "quick_prompts.global.set.response",
      payload: {
        requestId: request.requestId,
        items: request.items,
        success: true,
      },
    });
    this.emit({
      type: "quick_prompts.changed",
      scope: "global",
    });
  }

  handleProjectGet(
    request: Extract<SessionInboundMessage, { type: "quick_prompts.project.get.request" }>,
  ): void {
    const project = this.service.getProject(request.projectId);
    this.emit({
      type: "quick_prompts.project.get.response",
      payload: {
        requestId: request.requestId,
        projectId: request.projectId,
        items: project.items,
        disabledGlobalIds: project.disabledGlobalIds,
        order: project.order,
      },
    });
  }

  handleProjectSet(
    request: Extract<SessionInboundMessage, { type: "quick_prompts.project.set.request" }>,
  ): void {
    const updated = this.service.setProject(request.projectId, {
      items: request.items,
      disabledGlobalIds: request.disabledGlobalIds,
      order: request.order,
    });
    this.emit({
      type: "quick_prompts.project.set.response",
      payload: {
        requestId: request.requestId,
        projectId: request.projectId,
        items: updated.items,
        disabledGlobalIds: updated.disabledGlobalIds,
        order: updated.order,
        success: true,
      },
    });
    this.emit({
      type: "quick_prompts.changed",
      scope: "project",
      projectId: request.projectId,
    });
  }
}
