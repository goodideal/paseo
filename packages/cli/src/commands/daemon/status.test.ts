import { describe, expect, test } from "vitest";
import { daemonStatusCommand } from "./status.js";
import { parseTimeoutMs } from "./local-daemon.js";

describe("daemon status command options", () => {
  test("defines --timeout option with default 5 seconds", () => {
    const command = daemonStatusCommand();
    const timeoutOption = command.options.find((opt) => opt.long === "--timeout");
    expect(timeoutOption).toBeDefined();
    expect(timeoutOption?.description).toContain("5");
  });

  test("parseTimeoutMs parses timeout in seconds or defaults to 5000ms", () => {
    expect(parseTimeoutMs(undefined, 5_000)).toBe(5_000);
    expect(parseTimeoutMs("10", 5_000)).toBe(10_000);
    expect(parseTimeoutMs("2.5", 5_000)).toBe(2_500);
    expect(() => parseTimeoutMs("-1", 5_000)).toThrow();
  });
});
