import { describe, expect, it } from "vitest";
import { getPathBasename, isAbsolutePath } from "./path";

describe("isAbsolutePath", () => {
  it("returns true for Unix absolute paths", () => {
    expect(isAbsolutePath("/")).toBe(true);
    expect(isAbsolutePath("/home/user")).toBe(true);
    expect(isAbsolutePath("/tmp/file.txt")).toBe(true);
  });

  it("returns true for Windows drive letter paths", () => {
    expect(isAbsolutePath("C:\\Users")).toBe(true);
    expect(isAbsolutePath("C:/Users")).toBe(true);
    expect(isAbsolutePath("d:\\projects")).toBe(true);
  });

  it("returns true for UNC paths", () => {
    expect(isAbsolutePath("\\\\server\\share")).toBe(true);
    expect(isAbsolutePath("\\\\\\\\host\\path")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isAbsolutePath("foo/bar")).toBe(false);
    expect(isAbsolutePath("./relative")).toBe(false);
    expect(isAbsolutePath("../parent")).toBe(false);
    expect(isAbsolutePath("")).toBe(false);
    expect(isAbsolutePath("file.txt")).toBe(false);
  });

  it("returns false for edge cases that are not absolute paths", () => {
    expect(isAbsolutePath("")).toBe(false);
    expect(isAbsolutePath("C:")).toBe(false);
  });

  it("handles mixed separators in absolute paths", () => {
    expect(isAbsolutePath("C:/Users\\mixed/path")).toBe(true);
    expect(isAbsolutePath("/tmp\\mixed/path")).toBe(true);
  });
});

describe("getPathBasename", () => {
  it("returns the last segment of unix paths", () => {
    expect(getPathBasename("/home/user/project")).toBe("project");
    expect(getPathBasename("/home/user/project/")).toBe("project");
  });

  it("returns the last segment of windows paths", () => {
    expect(getPathBasename("C:\\Users\\user\\project")).toBe("project");
    expect(getPathBasename("C:\\Users\\user\\project\\")).toBe("project");
  });

  it("returns filename for simple filenames", () => {
    expect(getPathBasename("file.txt")).toBe("file.txt");
  });

  it("returns original path if empty or only separators", () => {
    expect(getPathBasename("")).toBe("");
    expect(getPathBasename("/")).toBe("/");
  });
});
