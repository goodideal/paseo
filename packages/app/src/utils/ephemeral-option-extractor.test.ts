import { describe, expect, it } from "vitest";
import { extractEphemeralOptions } from "./ephemeral-option-extractor";

describe("ephemeral-option-extractor", () => {
  it("returns empty array for empty or null text", () => {
    expect(extractEphemeralOptions(null)).toEqual([]);
    expect(extractEphemeralOptions("")).toEqual([]);
    expect(extractEphemeralOptions("   ")).toEqual([]);
  });

  it("extracts numbered options with bold markdown titles", () => {
    const text = `
Here are two options to consider:
1. **WebSocket**: Use native WebSockets for real-time latency.
2. **Polling**: Keep HTTP polling with debounce.

Which option do you prefer?
    `.trim();

    const options = extractEphemeralOptions(text, "en");
    expect(options).toHaveLength(2);

    expect(options[0].id).toBe("ephemeral-opt-1");
    expect(options[0].label).toBe("1. WebSocket");
    expect(options[0].content).toBe("I choose Option 1 (WebSocket). Please proceed.");
    expect(options[0].triggerType).toBe("ephemeral");
    expect(options[0].ephemeral).toBe(true);

    expect(options[1].id).toBe("ephemeral-opt-2");
    expect(options[1].label).toBe("2. Polling");
    expect(options[1].content).toBe("I choose Option 2 (Polling). Please proceed.");
  });

  it("falls back to Option N when option title is too long", () => {
    const text = `
We have several choices:
1. A completely custom architectural refactoring across multiple workspace modules
2. A fast drop-in shim that wraps existing functions with minimal changes

Please choose one:
    `.trim();

    const options = extractEphemeralOptions(text, "en");
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("Option 1");
    expect(options[1].label).toBe("Option 2");
  });

  it("extracts Chinese options and formats Chinese payloads", () => {
    const text = `
我们有两个可行的重构方案：
1. **重构缓存**：引入 Redis 进行全局统一缓存
2. **本地内存**：使用 LRU 内存缓存减少外部依赖

请选择方案 1 还是方案 2？
    `.trim();

    const options = extractEphemeralOptions(text, "zh-CN");
    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("1. 重构缓存");
    expect(options[0].content).toContain("我选择方案 1（重构缓存）");
    expect(options[1].label).toBe("2. 本地内存");
    expect(options[1].content).toContain("我选择方案 2（本地内存）");
  });

  it("extracts binary confirmation prompts (y/n)", () => {
    const text = "All changes will be reset. Proceed? (y/n)";
    const options = extractEphemeralOptions(text, "en");

    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("Proceed");
    expect(options[0].shortcut).toBe("yes");
    expect(options[1].label).toBe("Cancel");
    expect(options[1].shortcut).toBe("no");
  });

  it("extracts Chinese binary confirmation prompts", () => {
    const text = "即将清理所有未暂存的文件，是否确认继续？(y/n)";
    const options = extractEphemeralOptions(text, "zh-CN");

    expect(options).toHaveLength(2);
    expect(options[0].label).toBe("确认继续");
    expect(options[1].label).toBe("取消操作");
  });

  it("ignores numbered lists inside code blocks to prevent false positives", () => {
    const text = `
Here is an example code snippet:
\`\`\`bash
1. npm install
2. npm run build
\`\`\`
Done.
    `.trim();

    const options = extractEphemeralOptions(text, "en");
    expect(options).toHaveLength(0);
  });

  it("rejects non-sequential numbers", () => {
    const text = `
1. First item
4. Fourth item
    `.trim();

    const options = extractEphemeralOptions(text, "en");
    expect(options).toHaveLength(0);
  });

  it("assigns negative order so ephemeral options sort first", () => {
    const text = `
1. **Fast**: Quick run
2. **Thorough**: Full run
    `.trim();

    const options = extractEphemeralOptions(text, "en");
    expect(options[0].order).toBeLessThan(0);
    expect(options[1].order).toBeLessThan(0);
    expect(options[0].order).toBeLessThan(options[1].order);
  });
});
