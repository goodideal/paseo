export function installArrayPolyfills(target: typeof Array.prototype = Array.prototype): void {
  if (typeof target.findLast !== "function") {
    Object.defineProperty(target, "findLast", {
      value: function findLast<T>(
        this: T[],
        predicate: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): T | undefined {
        if (this == null) {
          throw new TypeError("Array.prototype.findLast called on null or undefined");
        }
        if (typeof predicate !== "function") {
          throw new TypeError(`${predicate} is not a function`);
        }
        for (let i = this.length - 1; i >= 0; i--) {
          const value = this[i]!;
          if (predicate.call(thisArg, value, i, this)) {
            return value;
          }
        }
        return undefined;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof target.findLastIndex !== "function") {
    Object.defineProperty(target, "findLastIndex", {
      value: function findLastIndex<T>(
        this: T[],
        predicate: (value: T, index: number, array: T[]) => unknown,
        thisArg?: unknown,
      ): number {
        if (this == null) {
          throw new TypeError("Array.prototype.findLastIndex called on null or undefined");
        }
        if (typeof predicate !== "function") {
          throw new TypeError(`${predicate} is not a function`);
        }
        for (let i = this.length - 1; i >= 0; i--) {
          if (predicate.call(thisArg, this[i]!, i, this)) {
            return i;
          }
        }
        return -1;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof target.toReversed !== "function") {
    Object.defineProperty(target, "toReversed", {
      value: function toReversed<T>(this: T[]): T[] {
        if (this == null) {
          throw new TypeError("Array.prototype.toReversed called on null or undefined");
        }
        // oxlint-disable-next-line eslint-plugin-unicorn(no-array-reverse) -- Polyfill implementation
        return Array.from(this).reverse();
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof target.toSorted !== "function") {
    Object.defineProperty(target, "toSorted", {
      value: function toSorted<T>(this: T[], compareFn?: (a: T, b: T) => number): T[] {
        if (this == null) {
          throw new TypeError("Array.prototype.toSorted called on null or undefined");
        }
        return Array.from(this).sort(compareFn);
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof target.toSpliced !== "function") {
    Object.defineProperty(target, "toSpliced", {
      value: function toSpliced<T>(
        this: T[],
        start: number,
        deleteCount?: number,
        ...items: T[]
      ): T[] {
        if (this == null) {
          throw new TypeError("Array.prototype.toSpliced called on null or undefined");
        }
        const copy = Array.from(this);
        if (arguments.length === 1) {
          copy.splice(start);
        } else {
          copy.splice(start, deleteCount ?? 0, ...items);
        }
        return copy;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }

  if (typeof target.with !== "function") {
    Object.defineProperty(target, "with", {
      value: function withItem<T>(this: T[], index: number, value: T): T[] {
        if (this == null) {
          throw new TypeError("Array.prototype.with called on null or undefined");
        }
        const len = this.length;
        const relativeIndex = Math.trunc(index);
        const actualIndex = relativeIndex < 0 ? len + relativeIndex : relativeIndex;
        if (actualIndex < 0 || actualIndex >= len) {
          throw new RangeError(`Invalid index : ${index}`);
        }
        const copy = Array.from(this);
        copy[actualIndex] = value;
        return copy;
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

export function polyfillArray(): void {
  installArrayPolyfills(Array.prototype);
}
