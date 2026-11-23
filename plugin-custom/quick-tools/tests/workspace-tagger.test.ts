import { describe, expect, it, vi } from "vitest";
import {
  LOCAL_LABEL_NAME,
  WORKTREE_LABEL_NAME,
  normalizeLabelKey,
  resolveTargetLabel,
  syncAllWorkspaces,
  tagWorkspace,
  type WorkspacesApi,
} from "../server/workspace-tagger.js";

function createMockWorkspaces(
  pages: Array<{
    entries: Array<{
      id: string;
      workspaceKind?: string;
      labels?: string[];
      background?: boolean;
      archivingAt?: string | null;
    }>;
    pageInfo?: { hasMore: boolean; nextCursor: string | null; prevCursor: string | null };
  }> = [],
) {
  const setLabel = vi.fn().mockResolvedValue({ labels: [] });
  const ref = vi.fn(() => ({ setLabel }));
  const list = vi.fn();
  for (const page of pages) {
    list.mockResolvedValueOnce({
      requestId: "req-1",
      entries: page.entries,
      pageInfo: page.pageInfo ?? { hasMore: false, nextCursor: null, prevCursor: null },
    });
  }
  return {
    workspaces: { list, ref } as unknown as WorkspacesApi,
    list,
    ref,
    setLabel,
  };
}

describe("workspace-tagger", () => {
  describe("constants & normalization", () => {
    it("uses Local and WT label names", () => {
      expect(LOCAL_LABEL_NAME).toBe("Local");
      expect(WORKTREE_LABEL_NAME).toBe("WT");
    });

    it("normalizes whitespace and casing", () => {
      expect(normalizeLabelKey("  Local  ")).toBe("local");
      expect(normalizeLabelKey("  WT ")).toBe("wt");
    });
  });

  describe("resolveTargetLabel", () => {
    it("maps worktree to WT with opposite Local", () => {
      expect(resolveTargetLabel("worktree")).toEqual({ target: "WT", opposite: "Local" });
    });

    it("maps local_checkout, checkout, and directory to Local with opposite WT", () => {
      expect(resolveTargetLabel("local_checkout")).toEqual({ target: "Local", opposite: "WT" });
      expect(resolveTargetLabel("checkout")).toEqual({ target: "Local", opposite: "WT" });
      expect(resolveTargetLabel("directory")).toEqual({ target: "Local", opposite: "WT" });
    });

    it("returns null for unknown or undefined kinds", () => {
      expect(resolveTargetLabel(undefined)).toBeNull();
      expect(resolveTargetLabel("remote")).toBeNull();
    });
  });

  describe("tagWorkspace", () => {
    it("assigns WT to an unlabeled worktree workspace", async () => {
      const { workspaces, ref, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace("ws-wt", "worktree", [], workspaces);

      expect(modified).toBe(true);
      expect(ref).toHaveBeenCalledWith("ws-wt");
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("WT", { assigned: true });
    });

    it("assigns Local to an unlabeled local workspace", async () => {
      const { workspaces, ref, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace("ws-local", "local_checkout", [], workspaces);

      expect(modified).toBe(true);
      expect(ref).toHaveBeenCalledWith("ws-local");
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("Local", { assigned: true });
    });

    it("assigns Local to a plain directory workspace", async () => {
      const { workspaces, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace("ws-dir", "directory", [], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledWith("Local", { assigned: true });
    });

    it("skips when target label is already present (case-insensitive) and opposite is absent", async () => {
      const { workspaces, ref, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace("ws-wt", "worktree", ["wt", "Priority"], workspaces);

      expect(modified).toBe(false);
      expect(ref).not.toHaveBeenCalled();
      expect(setLabel).not.toHaveBeenCalled();
    });

    it("removes opposite label and adds target label when mismatched", async () => {
      const { workspaces, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace("ws-wt", "worktree", ["Local", "KeepMe"], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(2);
      expect(setLabel).toHaveBeenNthCalledWith(1, "Local", { assigned: false });
      expect(setLabel).toHaveBeenNthCalledWith(2, "WT", { assigned: true });
    });

    it("removes opposite label only when both labels exist", async () => {
      const { workspaces, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace(
        "ws-local",
        "local_checkout",
        ["Local", "WT"],
        workspaces,
      );

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("WT", { assigned: false });
    });

    it("ignores malformed non-string labels", async () => {
      const { workspaces, setLabel } = createMockWorkspaces();
      const modified = await tagWorkspace(
        "ws-wt",
        "worktree",
        [null, undefined, 42, { name: "WT" }],
        workspaces,
      );

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledWith("WT", { assigned: true });
    });
  });

  describe("syncAllWorkspaces", () => {
    it("tags unlabeled workspaces across multiple pages and skips background/archiving ones", async () => {
      const { workspaces, list, ref, setLabel } = createMockWorkspaces([
        {
          entries: [
            { id: "ws-1", workspaceKind: "local_checkout", labels: [] },
            { id: "ws-2", workspaceKind: "worktree", labels: ["WT"] },
            { id: "ws-bg", workspaceKind: "worktree", labels: [], background: true },
            {
              id: "ws-archiving",
              workspaceKind: "local_checkout",
              labels: [],
              archivingAt: "2026-11-23T00:00:00Z",
            },
          ],
          pageInfo: { hasMore: true, nextCursor: "cursor-2", prevCursor: null },
        },
        {
          entries: [
            { id: "ws-3", workspaceKind: "worktree", labels: [] },
            { id: "ws-4", workspaceKind: "directory", labels: [] },
          ],
          pageInfo: { hasMore: false, nextCursor: null, prevCursor: "cursor-1" },
        },
      ]);

      const result = await syncAllWorkspaces(workspaces);

      expect(result).toEqual({ tagged: 3, skipped: 3 });
      expect(list).toHaveBeenCalledTimes(2);
      expect(list).toHaveBeenNthCalledWith(1, { page: { limit: 200 } });
      expect(list).toHaveBeenNthCalledWith(2, { page: { limit: 200, cursor: "cursor-2" } });
      expect(ref).toHaveBeenCalledWith("ws-1");
      expect(ref).toHaveBeenCalledWith("ws-3");
      expect(ref).toHaveBeenCalledWith("ws-4");
      expect(setLabel).toHaveBeenCalledTimes(3);
    });

    it("continues tagging remaining workspaces if one fails", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const { workspaces, setLabel } = createMockWorkspaces([
          {
            entries: [
              { id: "ws-fail", workspaceKind: "worktree", labels: [] },
              { id: "ws-ok", workspaceKind: "local_checkout", labels: [] },
            ],
          },
        ]);
        setLabel
          .mockRejectedValueOnce(new Error("Workspace concurrently deleted"))
          .mockResolvedValueOnce({ labels: ["Local"] });

        const result = await syncAllWorkspaces(workspaces);

        expect(result).toEqual({ tagged: 1, skipped: 1 });
        expect(setLabel).toHaveBeenCalledTimes(2);
        expect(warnSpy).toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
