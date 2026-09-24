import { describe, it, expect } from "vitest";
import { isImageFilePath } from "./file-type";

describe("isImageFilePath", () => {
  it("detects image file extensions correctly", () => {
    expect(isImageFilePath("test.png")).toBe(true);
    expect(isImageFilePath("assets/image.JPEG")).toBe(true);
    expect(isImageFilePath("icon.svg")).toBe(true);
    expect(isImageFilePath("photo.webp")).toBe(true);
    expect(isImageFilePath("fav.ico")).toBe(true);
    expect(isImageFilePath("graphic.bmp")).toBe(true);
    expect(isImageFilePath("picture.avif")).toBe(true);
    expect(isImageFilePath("animation.gif")).toBe(true);
  });

  it("rejects non-image extensions", () => {
    expect(isImageFilePath("document.txt")).toBe(false);
    expect(isImageFilePath("source.ts")).toBe(false);
    expect(isImageFilePath("data.json")).toBe(false);
    expect(isImageFilePath("README.md")).toBe(false);
    expect(isImageFilePath("archive.tar.gz")).toBe(false);
    expect(isImageFilePath("image_without_extension")).toBe(false);
  });
});
