/**
 * conflict/minHeap.js
 *
 * Binary min-heap (Assignment 2, section 4.5). Used by the sweep line as
 * the "active set", keyed by end time, so the interval that finishes
 * soonest is always at the top.
 *
 *   push O(log n)   pop O(log n)   peek O(1)   iterate O(n)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory());
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  class MinHeap {
    #items = [];
    #key;

    /** @param {(item) => number} key  value the heap orders by (default: the item itself) */
    constructor(key = (x) => x) {
      this.#key = key;
    }

    get size() {
      return this.#items.length;
    }

    /** Smallest item without removing it, or undefined if empty. O(1). */
    peek() {
      return this.#items[0];
    }

    /** Add an item. O(log n). */
    push(item) {
      const a = this.#items;
      a.push(item);
      let i = a.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.#key(a[parent]) <= this.#key(a[i])) break;
        [a[parent], a[i]] = [a[i], a[parent]];
        i = parent;
      }
    }

    /** Remove and return the smallest item, or undefined if empty. O(log n). */
    pop() {
      const a = this.#items;
      if (a.length === 0) return undefined;
      const top = a[0];
      const last = a.pop();
      if (a.length > 0) {
        a[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let smallest = i;
          if (l < a.length && this.#key(a[l]) < this.#key(a[smallest])) smallest = l;
          if (r < a.length && this.#key(a[r]) < this.#key(a[smallest])) smallest = r;
          if (smallest === i) break;
          [a[smallest], a[i]] = [a[i], a[smallest]];
          i = smallest;
        }
      }
      return top;
    }

    /** Visit every item (in heap order, not sorted). Do not push/pop while iterating. */
    [Symbol.iterator]() {
      return this.#items[Symbol.iterator]();
    }
  }

  return { MinHeap };
});
