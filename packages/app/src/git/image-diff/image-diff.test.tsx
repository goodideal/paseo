import { describe, it, expect } from "vitest";
import { isImageFilePath } from "./file-type";

describe("isImageFilePath", () => {
  it("detects image file extensions correctly", () => {
    expect(isImageFilePath("test.png")).toBe(true);
    expect(isImageFilePath("assets/image.JPEG")).toBe(true);
    expect(isImageFilePath("icon.svg")).toBe(true);
    expect(isImageFilePath("photo.webp")).toBe(true);
    expect(isImageFilePath("document.txt")).toBe(false);
    expect(isImageFilePath("image")).toBe(false);
  });
});
