import { describe, expect, it } from "vitest";
import { resolveMarkdownImageSource } from "./image-resolver";

describe("resolveMarkdownImageSource", () => {
  it("returns null for empty source", () => {
    expect(resolveMarkdownImageSource({ source: "", documentPath: "doc.md" })).toBeNull();
  });

  it("strips query and hash", () => {
    const res = resolveMarkdownImageSource({
      source: "https://example.com/img.png?raw=true#hash",
      documentPath: "doc.md",
    });
    expect(res).toEqual({ kind: "direct", uri: "https://example.com/img.png?raw=true#hash" });
  });

  it("resolves direct URLs", () => {
    expect(
      resolveMarkdownImageSource({ source: "http://example.com/1", documentPath: "a.md" }),
    ).toEqual({ kind: "direct", uri: "http://example.com/1" });
    expect(
      resolveMarkdownImageSource({ source: "data:image/png;base64,...", documentPath: "a.md" }),
    ).toEqual({ kind: "direct", uri: "data:image/png;base64,..." });
    expect(
      resolveMarkdownImageSource({ source: "blob:http://localhost/...", documentPath: "a.md" }),
    ).toEqual({ kind: "direct", uri: "blob:http://localhost/..." });
  });

  it("returns null if workspaceRoot is missing for local file", () => {
    expect(resolveMarkdownImageSource({ source: "img.png", documentPath: "doc.md" })).toBeNull();
  });

  it("resolves absolute path to workspace root", () => {
    const res = resolveMarkdownImageSource({
      source: "/static/logo.png?raw=1",
      documentPath: "some/folder/doc.md",
      workspaceRoot: "/workspace",
    });
    expect(res).toEqual({ kind: "file", cwd: "/workspace", path: "static/logo.png" });
  });

  it("resolves relative path in same dir", () => {
    const res = resolveMarkdownImageSource({
      source: "./assets/flow.png",
      documentPath: "docs/arch.md",
      workspaceRoot: "/workspace",
    });
    expect(res).toEqual({ kind: "file", cwd: "/workspace", path: "docs/assets/flow.png" });
  });

  it("resolves relative path without ./", () => {
    const res = resolveMarkdownImageSource({
      source: "assets/banner.webp",
      documentPath: "docs/arch.md",
      workspaceRoot: "/workspace",
    });
    expect(res).toEqual({ kind: "file", cwd: "/workspace", path: "docs/assets/banner.webp" });
  });

  it("resolves parent dir relative path", () => {
    const res = resolveMarkdownImageSource({
      source: "../img/logo.jpg",
      documentPath: "docs/nested/arch.md",
      workspaceRoot: "/workspace",
    });
    expect(res).toEqual({ kind: "file", cwd: "/workspace", path: "docs/img/logo.jpg" });
  });

  it("prevents directory traversal outside workspace root", () => {
    expect(
      resolveMarkdownImageSource({
        source: "../../img/logo.jpg",
        documentPath: "docs/arch.md", // only one level deep
        workspaceRoot: "/workspace",
      }),
    ).toBeNull();

    expect(
      resolveMarkdownImageSource({
        source: "/../etc/passwd",
        documentPath: "docs/arch.md",
        workspaceRoot: "/workspace",
      }),
    ).toBeNull();
  });
});
