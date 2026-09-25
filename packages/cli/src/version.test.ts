import { describe, expect, it } from "vitest";
import { formatDisplayCliVersion, resolveCliVersion } from "./version.js";

describe("cli version formatting", () => {
  it("resolves raw cli version from package.json", () => {
    const raw = resolveCliVersion();
    expect(raw).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("formats standard official release version without modification tag", () => {
    expect(formatDisplayCliVersion("0.9.2")).toBe("v0.9.2");
    expect(formatDisplayCliVersion("v0.9.2")).toBe("v0.9.2");
  });

  it("formats custom version with timestamp suffix into [mod-DDhhmm]", () => {
    expect(formatDisplayCliVersion("0.9.2-custom.251223")).toBe("v0.9.2 [mod-251223]");
    expect(formatDisplayCliVersion("v0.9.2-custom.251223")).toBe("v0.9.2 [mod-251223]");
    expect(formatDisplayCliVersion("0.9.2-custom-251223")).toBe("v0.9.2 [mod-251223]");
  });

  it("preserves already formatted [mod-DDhhmm] version", () => {
    expect(formatDisplayCliVersion("v0.9.2 [mod-251223]")).toBe("v0.9.2 [mod-251223]");
    expect(formatDisplayCliVersion("0.9.2 [mod-251223]")).toBe("v0.9.2 [mod-251223]");
  });

  it("formats generic -custom version with current timestamp", () => {
    expect(formatDisplayCliVersion("0.9.2-custom")).toMatch(/^v0\.9\.2 \[mod-\d{6}\]$/);
  });
});
