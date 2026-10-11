import { describe, expect, it } from "vitest";
import { resolveWorkspaceTitle } from "./workspace-setup-title";

describe("resolveWorkspaceTitle", () => {
  it("prefers workspace.name if present", () => {
    expect(
      resolveWorkspaceTitle({
        workspace: { name: "custom-name" },
        displayName: "project-display",
        sourceDirectory: "/path/to/project",
      }),
    ).toBe("custom-name");
  });

  it("prefers workspace.projectDisplayName if name is not present", () => {
    expect(
      resolveWorkspaceTitle({
        workspace: { projectDisplayName: "project-display" },
        displayName: "display-name",
        sourceDirectory: "/path/to/project",
      }),
    ).toBe("project-display");
  });

  it("falls back to displayName if workspace names are empty", () => {
    expect(
      resolveWorkspaceTitle({
        workspace: null,
        displayName: "my-display",
        sourceDirectory: "/path/to/project",
      }),
    ).toBe("my-display");
  });

  it("extracts directory basename when displayName is empty, even without Array.prototype.findLast", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, "findLast");
    Reflect.deleteProperty(Array.prototype, "findLast");
    try {
      expect(
        resolveWorkspaceTitle({
          workspace: null,
          displayName: "",
          sourceDirectory: "/Users/jerry/my-workspace/",
        }),
      ).toBe("my-workspace");

      expect(
        resolveWorkspaceTitle({
          workspace: null,
          displayName: "",
          sourceDirectory: "C:\\Users\\jerry\\my-workspace",
        }),
      ).toBe("my-workspace");

      expect(
        resolveWorkspaceTitle({
          workspace: null,
          displayName: "",
          sourceDirectory: "",
        }),
      ).toBe("");
    } finally {
      if (descriptor) {
        Reflect.defineProperty(Array.prototype, "findLast", descriptor);
      }
    }
  });
});
