/**
 * scheduling/intervals.js
 *
 * Algorithm 2 (interval merging) and Algorithm 3 (window complement)
 * from Assignment 2. Both work on plain { start, end } objects in
 * integer minutes, half-open [start, end).
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

  /**
   * Merge possibly overlapping intervals into maximal, disjoint blocks,
   * sorted by start. Touching intervals are merged too: there is no free
   * time between them. Input order does not matter; input is not changed.
   *
   * Time O(n log n) (O(n) if already sorted), space O(n).
   */
  function mergeIntervals(intervals) {
    if (intervals.length === 0) return [];
    const sorted = intervals.map((x) => ({ start: x.start, end: x.end }))
      .sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      const x = sorted[i];
      const last = merged[merged.length - 1];
      if (x.start <= last.end) {
        last.end = Math.max(last.end, x.end); // overlapping or touching
      } else {
        merged.push(x);
      }
    }
    return merged;
  }

  /**
   * Free gaps inside `window` = window minus the busy blocks.
   * `merged` must be disjoint and sorted (the output of mergeIntervals);
   * blocks may stick out past the window's edges.
   *
   * Time O(m), space O(m).
   */
  function complement(merged, window) {
    const gaps = [];
    let cursor = window.start; // earliest minute not yet known to be busy or emitted
    for (const b of merged) {
      if (b.start > cursor) gaps.push({ start: cursor, end: Math.min(b.start, window.end) });
      cursor = Math.max(cursor, b.end);
      if (cursor >= window.end) break;
    }
    if (cursor < window.end) gaps.push({ start: cursor, end: window.end });
    return gaps;
  }

  /** Clip intervals to a window, dropping the ones outside it. */
  function clipToWindow(intervals, window) {
    const out = [];
    for (const x of intervals) {
      const s = Math.max(x.start, window.start);
      const e = Math.min(x.end, window.end);
      if (s < e) out.push({ start: s, end: e });
    }
    return out;
  }

  return { mergeIntervals, complement, clipToWindow };
});
