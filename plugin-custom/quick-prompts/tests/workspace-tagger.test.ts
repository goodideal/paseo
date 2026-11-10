import { describe, expect, it, vi } from "vitest";
import type { WorkspaceLabelDefinition } from "@getpaseo/protocol/workspace-labels";
import type { PaseoWorkspaceActions } from "@getpaseo/client";
import {
  WORKTREE_LABEL,
  LOCAL_LABEL,
  resolveTargetLabel,
  tagWorkspace,
  syncAllWorkspaces,
} from "../server/workspace-tagger.js";

describe("workspace-tagger", () => {
  describe("constants", () => {
    it("defines WORKTREE_LABEL with sky color", () => {
      expect(WORKTREE_LABEL).toEqual({ name: "Worktree", color: "sky" });
    });

    it("defines LOCAL_LABEL with amber color", () => {
      expect(LOCAL_LABEL).toEqual({ name: "Local", color: "amber" });
    });
  });

  describe("resolveTargetLabel", () => {
    it("resolves worktree to WORKTREE_LABEL as target and LOCAL_LABEL as opposite", () => {
      expect(resolveTargetLabel("worktree")).toEqual({
        target: WORKTREE_LABEL,
        opposite: LOCAL_LABEL,
      });
    });

    it("resolves local_checkout to LOCAL_LABEL as target and WORKTREE_LABEL as opposite", () => {
      expect(resolveTargetLabel("local_checkout")).toEqual({
        target: LOCAL_LABEL,
        opposite: WORKTREE_LABEL,
      });
    });

    it("resolves checkout to LOCAL_LABEL as target and WORKTREE_LABEL as opposite", () => {
      expect(resolveTargetLabel("checkout")).toEqual({
        target: LOCAL_LABEL,
        opposite: WORKTREE_LABEL,
      });
    });

    it("returns null for non-git directory workspaces", () => {
      expect(resolveTargetLabel("directory")).toBeNull();
    });

    it("returns null for unknown workspace kinds", () => {
      expect(resolveTargetLabel("unknown")).toBeNull();
      expect(resolveTargetLabel("")).toBeNull();
    });
  });

  describe("tagWorkspace", () => {
    it("tags unlabelled worktree with WORKTREE_LABEL", async () => {
      const setLabel = vi.fn().mockResolvedValue({ workspaceId: "ws-1", labels: [WORKTREE_LABEL] });
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", [], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-1", WORKTREE_LABEL, true);
    });

    it("tags unlabelled local_checkout with LOCAL_LABEL", async () => {
      const setLabel = vi.fn().mockResolvedValue({ workspaceId: "ws-2", labels: [LOCAL_LABEL] });
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-2", "local_checkout", [], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-2", LOCAL_LABEL, true);
    });

    it("tags unlabelled checkout with LOCAL_LABEL", async () => {
      const setLabel = vi.fn().mockResolvedValue({ workspaceId: "ws-3", labels: [LOCAL_LABEL] });
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-3", "checkout", undefined, workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-3", LOCAL_LABEL, true);
    });

    it("skips if WORKTREE_LABEL is already present (string format, case-insensitive)", async () => {
      const setLabel = vi.fn();
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", ["worktree"], workspaces);

      expect(modified).toBe(false);
      expect(setLabel).not.toHaveBeenCalled();
    });

    it("skips if WORKTREE_LABEL is already present (object format)", async () => {
      const setLabel = vi.fn();
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", [WORKTREE_LABEL], workspaces);

      expect(modified).toBe(false);
      expect(setLabel).not.toHaveBeenCalled();
    });

    it("skips if LOCAL_LABEL is already present on local_checkout (case-insensitive)", async () => {
      const setLabel = vi.fn();
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-2", "local_checkout", ["Local"], workspaces);

      expect(modified).toBe(false);
      expect(setLabel).not.toHaveBeenCalled();
    });

    it("removes LOCAL_LABEL and assigns WORKTREE_LABEL on type switch to worktree", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", ["Local"], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(2);
      expect(setLabel).toHaveBeenNthCalledWith(1, "ws-1", LOCAL_LABEL, false);
      expect(setLabel).toHaveBeenNthCalledWith(2, "ws-1", WORKTREE_LABEL, true);
    });

    it("removes WORKTREE_LABEL and assigns LOCAL_LABEL on type switch to local_checkout", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace(
        "ws-2",
        "local_checkout",
        [{ name: "Worktree", color: "sky" }],
        workspaces,
      );

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(2);
      expect(setLabel).toHaveBeenNthCalledWith(1, "ws-2", WORKTREE_LABEL, false);
      expect(setLabel).toHaveBeenNthCalledWith(2, "ws-2", LOCAL_LABEL, true);
    });

    it("removes opposite label even if target label is already present", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", ["Worktree", "Local"], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-1", LOCAL_LABEL, false);
    });

    it("skips non-git directory workspaces without calling setLabel", async () => {
      const setLabel = vi.fn();
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-dir", "directory", [], workspaces);

      expect(modified).toBe(false);
      expect(setLabel).not.toHaveBeenCalled();
    });

    it("preserves unrelated custom labels when adding target label", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const modified = await tagWorkspace("ws-1", "worktree", ["Feature-Alpha", "WIP"], workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-1", WORKTREE_LABEL, true);
    });

    it("defensively ignores null, undefined, or malformed label objects", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces: Pick<PaseoWorkspaceActions, "setLabel"> = { setLabel };

      const malformedLabels = [null, undefined, {}, { name: undefined }] as any;
      const modified = await tagWorkspace("ws-1", "worktree", malformedLabels, workspaces);

      expect(modified).toBe(true);
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-1", WORKTREE_LABEL, true);
    });
  });

  describe("syncAllWorkspaces", () => {
    it("iterates workspaces and tags missing labels, counting tagged and skipped", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces = {
        list: vi.fn().mockResolvedValue({
          entries: [
            { id: "ws-wt-1", workspaceKind: "worktree", labels: [] },
            { id: "ws-wt-2", workspaceKind: "worktree", labels: ["Worktree"] },
            { id: "ws-loc-1", workspaceKind: "local_checkout", labels: [] },
            { id: "ws-dir-1", workspaceKind: "directory", labels: [] },
          ],
        }),
        setLabel,
      } as unknown as Pick<PaseoWorkspaceActions, "list" | "setLabel">;

      const result = await syncAllWorkspaces(workspaces);

      expect(result).toEqual({ tagged: 2, skipped: 2 });
      expect(setLabel).toHaveBeenCalledTimes(2);
      expect(setLabel).toHaveBeenCalledWith("ws-wt-1", WORKTREE_LABEL, true);
      expect(setLabel).toHaveBeenCalledWith("ws-loc-1", LOCAL_LABEL, true);
    });

    it("supports workspaces.list returning array directly", async () => {
      const setLabel = vi.fn().mockResolvedValue({});
      const workspaces = {
        list: vi.fn().mockResolvedValue([
          { id: "ws-wt-1", workspaceKind: "worktree", labels: [] },
          { id: "ws-dir-1", workspaceKind: "directory", labels: [] },
        ]),
        setLabel,
      } as unknown as Pick<PaseoWorkspaceActions, "list" | "setLabel">;

      const result = await syncAllWorkspaces(workspaces);

      expect(result).toEqual({ tagged: 1, skipped: 1 });
      expect(setLabel).toHaveBeenCalledTimes(1);
      expect(setLabel).toHaveBeenCalledWith("ws-wt-1", WORKTREE_LABEL, true);
    });

    it("handles empty list", async () => {
      const setLabel = vi.fn();
      const workspaces = {
        list: vi.fn().mockResolvedValue({ entries: [] }),
        setLabel,
      } as unknown as Pick<PaseoWorkspaceActions, "list" | "setLabel">;

      const result = await syncAllWorkspaces(workspaces);

      expect(result).toEqual({ tagged: 0, skipped: 0 });
      expect(setLabel).not.toHaveBeenCalled();
    });
  });
});
