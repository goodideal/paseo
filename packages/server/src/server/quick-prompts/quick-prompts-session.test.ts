import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { QuickPromptsSession } from "./quick-prompts-session.js";
import type { SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { DEFAULT_QUICK_PROMPT_ITEMS } from "@getpaseo/protocol/quick-prompts";

describe("QuickPromptsSession", () => {
  let tempHome: string;
  let emitted: SessionOutboundMessage[];
  let session: QuickPromptsSession;

  beforeEach(() => {
    tempHome = mkdtempSync(path.join(tmpdir(), "paseo-test-qp-session-"));
    emitted = [];
    session = new QuickPromptsSession(tempHome, (msg) => emitted.push(msg));
  });

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("handles global get and returns default items", () => {
    session.handleGlobalGet({
      type: "quick_prompts.global.get.request",
      requestId: "req_1",
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "quick_prompts.global.get.response",
      payload: {
        requestId: "req_1",
        items: DEFAULT_QUICK_PROMPT_ITEMS,
      },
    });
  });

  it("handles global set and emits response and changed event", () => {
    const newItems = [
      {
        id: "test-global-1",
        label: "Git Status",
        content: "git status",
        triggerType: "fixed" as const,
        enabled: true,
        createdAt: 123,
        order: 0,
      },
    ];

    session.handleGlobalSet({
      type: "quick_prompts.global.set.request",
      requestId: "req_2",
      items: newItems,
    });

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toEqual({
      type: "quick_prompts.global.set.response",
      payload: {
        requestId: "req_2",
        items: newItems,
        success: true,
      },
    });
    expect(emitted[1]).toEqual({
      type: "quick_prompts.changed",
      scope: "global",
    });
  });

  it("handles project get and set with changed notification", () => {
    session.handleProjectGet({
      type: "quick_prompts.project.get.request",
      requestId: "req_3",
      projectId: "prj_test",
    });

    expect(emitted[0]).toEqual({
      type: "quick_prompts.project.get.response",
      payload: {
        requestId: "req_3",
        projectId: "prj_test",
        items: [],
        disabledGlobalIds: [],
        order: undefined,
      },
    });

    const projectItem = {
      id: "prj-cmd-1",
      label: "Run Lint",
      content: "pnpm lint",
      triggerType: "fixed" as const,
      enabled: true,
      createdAt: 456,
      order: 0,
    };

    session.handleProjectSet({
      type: "quick_prompts.project.set.request",
      requestId: "req_4",
      projectId: "prj_test",
      items: [projectItem],
      disabledGlobalIds: ["builtin-review"],
    });

    expect(emitted[1]).toEqual({
      type: "quick_prompts.project.set.response",
      payload: {
        requestId: "req_4",
        projectId: "prj_test",
        items: [projectItem],
        disabledGlobalIds: ["builtin-review"],
        order: undefined,
        success: true,
      },
    });
    expect(emitted[2]).toEqual({
      type: "quick_prompts.changed",
      scope: "project",
      projectId: "prj_test",
    });
  });
});
