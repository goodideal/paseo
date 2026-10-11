import { describe, expect, it } from "vitest";
import { installArrayPolyfills } from "./array";

describe("installArrayPolyfills", () => {
  it("installs findLast and finds the last matching element", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const arr = [1, 2, 3, 4, 5, 2];
    const result = target.findLast.call(arr, (val: number) => val % 2 === 0);
    expect(result).toBe(2);

    const none = target.findLast.call(arr, (val: number) => val > 10);
    expect(none).toBeUndefined();
  });

  it("installs findLastIndex and finds the index of the last matching element", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const arr = [1, 2, 3, 4, 5, 2];
    const result = target.findLastIndex.call(arr, (val: number) => val === 2);
    expect(result).toBe(5);

    const none = target.findLastIndex.call(arr, (val: number) => val === 99);
    expect(none).toBe(-1);
  });

  it("installs toReversed which returns a reversed copy without mutating original", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const original = [1, 2, 3];
    const reversed = target.toReversed.call(original);
    expect(reversed).toEqual([3, 2, 1]);
    expect(original).toEqual([1, 2, 3]);
  });

  it("installs toSorted which returns a sorted copy without mutating original", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const original = [3, 1, 2];
    const sorted = target.toSorted.call(original);
    expect(sorted).toEqual([1, 2, 3]);
    expect(original).toEqual([3, 1, 2]);

    const descending = target.toSorted.call(original, (a: number, b: number) => b - a);
    expect(descending).toEqual([3, 2, 1]);
  });

  it("installs toSpliced which returns a spliced copy without mutating original", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const original = ["a", "b", "c", "d"];
    const spliced = Reflect.apply(target.toSpliced, original, [1, 2, "x", "y"]);
    expect(spliced).toEqual(["a", "x", "y", "d"]);
    expect(original).toEqual(["a", "b", "c", "d"]);
  });

  it("installs with which returns a copy with element replaced", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const original = ["a", "b", "c"];
    const updated = target.with.call(original, 1, "z");
    expect(updated).toEqual(["a", "z", "c"]);
    expect(original).toEqual(["a", "b", "c"]);

    const negative = target.with.call(original, -1, "last");
    expect(negative).toEqual(["a", "b", "last"]);

    expect(() => target.with.call(original, 5, "out")).toThrow(RangeError);
    expect(() => target.with.call(original, -4, "out")).toThrow(RangeError);
  });

  it("ensures installed polyfills are non-enumerable", () => {
    const target = {} as unknown as typeof Array.prototype;
    installArrayPolyfills(target);

    const keys = Object.keys(target);
    expect(keys).toEqual([]);
  });
});
