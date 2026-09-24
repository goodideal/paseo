import { describe, expect, test, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitBlob } from "./checkout-git.js";

describe("getGitBlob", () => {
  let repoDir: string;

  beforeAll(() => {
    repoDir = mkdtempSync(join(tmpdir(), "paseo-git-blob-test-"));
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });

    // Create a dummy png file
    writeFileSync(
      join(repoDir, "test.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    execFileSync("git", ["add", "test.png"], { cwd: repoDir });
    execFileSync("git", ["commit", "-m", "add test image"], { cwd: repoDir });
  });

  afterAll(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  test("reads valid image blob by commit ref and path", async () => {
    const result = await getGitBlob({
      cwd: repoDir,
      ref: "HEAD",
      path: "test.png",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.mimeType).toBe("image/png");
      expect(result.size).toBe(8);
      expect(Buffer.from(result.base64Data, "base64")).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
    }
  });

  test("returns missing for nonexistent file", async () => {
    const result = await getGitBlob({
      cwd: repoDir,
      ref: "HEAD",
      path: "nonexistent.png",
    });

    expect(result.status).toBe("missing");
  });

  test("returns too_large when blob exceeds maxBytes", async () => {
    const result = await getGitBlob({
      cwd: repoDir,
      ref: "HEAD",
      path: "test.png",
      maxBytes: 4, // size is 8
    });

    expect(result.status).toBe("too_large");
    if (result.status === "too_large") {
      expect(result.size).toBe(8);
    }
  });
});
