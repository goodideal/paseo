import { describe, expect, it, vi } from "vitest";
import {
  extractEphemeralOptions,
  cleanOptionTitle,
  type ExtractorDiagnostic,
} from "../client/ephemeral-option-extractor.js";

describe("ephemeral-option-extractor", () => {
  describe("diagnostic logging", () => {
    it("logs diagnostic details through logger or console.debug", () => {
      const logs: string[] = [];
      const customLogger = (msg: string) => {
        logs.push(msg);
      };

      const result = extractEphemeralOptions(
        "请问您希望选择哪种方案？\n1. 方案一\n2. 方案二",
        "zh",
        { logger: customLogger },
      );

      expect(result.length).toBe(2);
      expect(logs.some((l) => l.includes("[QuickPrompts:Extractor]"))).toBe(true);
    });

    it("logs rejection reason when text is a completion report", () => {
      const logs: string[] = [];
      const customLogger = (msg: string) => {
        logs.push(msg);
      };

      const text = `
本次修改已完成如下内容：
1. **元数据注入**：在 Agent 启动时注入；
2. **网关 URL 增强**：自动检测所有常见 LLM 网关；
3. **UI 配置面板**：提供设置页面。
全部测试用例通过。
`;
      const result = extractEphemeralOptions(text, "zh", { logger: customLogger });
      expect(result).toEqual([]);
      expect(logs.some((l) => l.includes("Rejected") || l.includes("Skipped"))).toBe(true);
    });
  });

  describe("negative cases (historical false positives must NOT trigger)", () => {
    it("does NOT extract buttons from status / completion reports", () => {
      const text = `
- **已交付内容**：
  1. **元数据注入**：在 Agent 启动时（\`agent.session_open\`）自动向进程环境变量注入；
  2. **网关 URL 增强**：自动检测所有常见 LLM 网关 Base URL；
  3. **UI 配置面板**：提供完整的客户端设置页面（\`settings-screen.tsx\`）。
- **健康状态**：
  - 运行单元测试：**13 个测试用例全部通过（13 passed）**。
`;
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });

    it("does NOT extract buttons from design / architecture explanations", () => {
      const text = `
项目中所有的定制扩展均遵循这一结构：
1. **隔离官方上游代码，避免 Git 合并冲突**：定制功能集中在 plugin-custom；
2. **即插即用生命周期管理**：软链接入；
3. **统一定制插件生态**：源文件集中管理。
`;
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });

    it("does NOT extract buttons from git inspection summaries", () => {
      const text = `
当前工作区状态：
1. **工作区状态与检查**：nothing to commit, working tree clean；
2. **远程推送**：本地与 origin/custom-features 完全保持同步。
`;
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });

    it("does NOT extract buttons from task state summaries", () => {
      const text = `
宠物整体状态裁决如下：
1. **只要存在任一 P0 任务** -> 宠物整体进入 ALARM；
2. **无 P0 但有 P1 任务** -> 宠物进入 WORKING；
3. **存在 ERROR 且无活跃任务** -> 宠物进入 CONFUSED；
4. **全为空闲或已停止** -> 宠物进入 IDLE。
`;
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });

    it("does NOT falsely trigger binary confirmation on open review / plan questions", () => {
      const text = "请确认计划内容是否满足你的期望，并告诉我希望使用哪种方式开始执行？";
      // This is an open-ended question, not a binary y/n confirmation
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });

    it("does NOT falsely trigger binary confirmation on multi-part reviews", () => {
      const text =
        "请确认第 1 部分（数据结构与默认模板）是否符合你的预期？若确认无误，我们将进入第 2 部分。";
      expect(extractEphemeralOptions(text, "zh")).toEqual([]);
    });
  });

  describe("positive cases (real choices extracted with high quality)", () => {
    it("extracts real branch choices cleanly without degrading to '选项 2'", () => {
      const text = `
关于本地合并，请问您的目标是：

1. **直接保持在当前分支**：本次提交已合并进本地 \`custom-features\` 分支（无需额外操作）。
2. **合并到 \`main\` 分支**：将当前包含本次修复的 \`custom-features\` 本地 merge 到本地 \`main\` 分支。
3. **合并到其他特定分支**（例如其它功能或发布分支）？
`;
      const result = extractEphemeralOptions(text, "zh");
      expect(result.length).toBe(3);

      expect(result[0].label).toBe("1. 直接保持在当前分支");
      expect(result[1].label).toBe("2. 合并到 main 分支");
      expect(result[2].label).toBe("3. 合并到其他特定分支");

      expect(result[0].content).toContain("直接保持在当前分支");
      expect(result[1].content).toContain("合并到 main 分支");
      expect(result[2].content).toContain("合并到其他特定分支");
    });

    it("supports Chinese dunhao format (1、 2、)", () => {
      const text = `
请问您希望如何处理当前的改动：
1、立即将修复合并入本地主分支
2、暂存当前修改并在独立分支测试
`;
      const result = extractEphemeralOptions(text, "zh");
      expect(result.length).toBe(2);
      expect(result[0].label).toBe("1. 立即将修复合并入本地主分支");
      expect(result[1].label).toBe("2. 暂存当前修改并在独立分支测试");
    });

    it("supports Chinese numeral format (一、 二、)", () => {
      const text = `
你有以下两种实现方案可供选择：
一、基于 AST 深度静态分析
二、基于正则与启发式规则匹配
`;
      const result = extractEphemeralOptions(text, "zh");
      expect(result.length).toBe(2);
      expect(result[0].label).toBe("1. 基于 AST 深度静态分析");
      expect(result[1].label).toBe("2. 基于正则与启发式规则匹配");
    });

    it("supports English choice questions with clean markdown titles", () => {
      const text = `
Which deployment strategy do you prefer?
1. **Canary deployment**: Roll out to 10% first
2. **Blue-green deployment**: Switch traffic instantly
`;
      const result = extractEphemeralOptions(text, "en");
      expect(result.length).toBe(2);
      expect(result[0].label).toBe("1. Canary deployment");
      expect(result[1].label).toBe("2. Blue-green deployment");
      expect(result[0].content).toContain("Canary deployment");
      expect(result[1].content).toContain("Blue-green deployment");
    });

    it("handles explicit binary confirmation (y/n)", () => {
      const text = "Do you want to proceed with this destructive migration? (y/n)";
      const result = extractEphemeralOptions(text, "en");
      expect(result.length).toBe(2);
      expect(result[0].shortcut).toBe("yes");
      expect(result[1].shortcut).toBe("no");
    });
  });

  describe("cleanOptionTitle helper", () => {
    it("cleans markdown backticks, bold syntax, and redundant prefixes", () => {
      expect(cleanOptionTitle("**合并到 `main` 分支**")).toBe("合并到 main 分支");
      expect(cleanOptionTitle("方案 1: **直接测试**")).toBe("直接测试");
      expect(cleanOptionTitle("1. `auth-service` 模块重构")).toBe("auth-service 模块重构");
    });
  });
});
