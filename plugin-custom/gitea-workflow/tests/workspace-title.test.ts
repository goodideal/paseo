import { describe, expect, it } from "vitest";
import {
  cleanIssueTitle,
  detectIssueKind,
  formatWorkflowWorkspaceTitle,
} from "../server/workspace-title.js";

describe("Workspace Title Formatter", () => {
  describe("detectIssueKind", () => {
    it("detects bug from labels", () => {
      expect(detectIssueKind("Some task", [{ name: "bug" }])).toBe("bug");
      expect(detectIssueKind("Some task", [{ name: "Defect" }])).toBe("bug");
      expect(detectIssueKind("Some task", [{ name: "缺陷" }])).toBe("bug");
    });

    it("detects bug from title keywords and brackets", () => {
      expect(detectIssueKind("[BUG] [SP1] 修复登录崩溃")).toBe("bug");
      expect(detectIssueKind("fix: 解决白屏问题")).toBe("bug");
      expect(detectIssueKind("修复网络超时异常")).toBe("bug");
      expect(detectIssueKind("[Defect] button broken")).toBe("bug");
    });

    it("detects feature from labels or keywords", () => {
      expect(detectIssueKind("优化登录流程", [{ name: "feature" }])).toBe("feature");
      expect(detectIssueKind("[req/TR] [S] [P1] 支持下游断连感知")).toBe("feature");
      expect(detectIssueKind("[Feat] add new provider")).toBe("feature");
      expect(detectIssueKind("新增数据导出功能")).toBe("feature");
    });

    it("defaults to feature when ambiguous", () => {
      expect(detectIssueKind("重构网络模块")).toBe("feature");
    });
  });

  describe("cleanIssueTitle", () => {
    it("strips continuous bracket prefixes like [req/TR] [S] [P1] [SP1]", () => {
      const raw = "[req/TR] [S] [P1] 支持下游断连感知与上游流式推理的主动取消熔断";
      expect(cleanIssueTitle(raw)).toBe("支持下游断连感知与上游流式推理的主动取消熔断");
    });

    it("strips SP1 / SP2 bare and bracket prefixes", () => {
      expect(cleanIssueTitle("[SP1] [P0] 修复登录白屏")).toBe("修复登录白屏");
      expect(cleanIssueTitle("SP1: 优化启动性能")).toBe("优化启动性能");
      expect(cleanIssueTitle("SP2 - 增加快捷方式")).toBe("增加快捷方式");
      expect(cleanIssueTitle("[sp3] 支持暗色模式")).toBe("支持暗色模式");
    });

    it("strips leading bug/feat/fix prefixes", () => {
      expect(cleanIssueTitle("[BUG] 修复内存泄露")).toBe("修复内存泄露");
      expect(cleanIssueTitle("fix(auth): resolve oauth token expiry")).toBe(
        "resolve oauth token expiry",
      );
      expect(cleanIssueTitle("feat: add gitea integration")).toBe("add gitea integration");
    });

    it("preserves internal brackets that are part of the main title", () => {
      const raw = "[req/TR] [P1] [Core] 引擎热重载 (Beta)";
      // [req/TR] and [P1] are noise, while non-noise brackets like [Core] are kept if not in noise pattern
      expect(cleanIssueTitle(raw)).toBe("[Core] 引擎热重载 (Beta)");
    });

    it("falls back to truncated raw title if everything was stripped", () => {
      expect(cleanIssueTitle("[SP1] [P0]")).toBe("[SP1] [P0]");
    });
  });

  describe("formatWorkflowWorkspaceTitle", () => {
    it("formats Bug title with emoji and [Bug]", () => {
      const title = formatWorkflowWorkspaceTitle({
        issueNumber: 99,
        rawTitle: "[BUG] [SP2] 修复登录白屏崩溃问题",
      });
      expect(title).toBe("🐞 #99 [Bug] 修复登录白屏崩溃问题");
    });

    it("formats Feature title with emoji and [Feature]", () => {
      const title = formatWorkflowWorkspaceTitle({
        issueNumber: 138,
        rawTitle: "[req/TR] [S] [P1] 支持下游断连感知与上游流式推理的主动取消熔断",
      });
      expect(title).toBe("✨ #138 [Feature] 支持下游断连感知与上游流式推理的主动取消熔断");
    });

    it("takes labels into account for bug determination", () => {
      const title = formatWorkflowWorkspaceTitle({
        issueNumber: 42,
        rawTitle: "[SP1] 页面滑动卡顿",
        labels: [{ name: "bug" }],
      });
      expect(title).toBe("🐞 #42 [Bug] 页面滑动卡顿");
    });
  });
});
