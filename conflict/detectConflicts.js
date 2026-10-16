/**
 * conflict/detectConflicts.js
 *
 * Sweep-line overlap detection (Assignment 2, Algorithm 1).
 *
 * Input:  items with { id, start, end } (Events or intervals), half-open
 *         [start, end) in integer minutes, usually store.eventsOn(day).
 * Output: Conflict records, one per overlapping pair:
 *         { eventA, eventB, overlapStart, overlapEnd, overlapMinutes }
 *         eventA is the one that starts first (ties: shorter, then smaller id).
 *
 * Touching events (one ends exactly when the other starts) are NOT conflicts.
 *
 * Time:  O(n log n + k) for n items and k conflicting pairs
 *        (O(n^2) only when every item overlaps every other, because all
 *        k = n(n-1)/2 pairs must be reported).
 * Space: O(n) for the heap, O(k) for the output.
 *
 * This module only reads plain data. It never touches the store or the UI.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./minHeap.js"));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const { MinHeap } = deps;

  /** Sweep order: start, then end, then id. Same order as the store's day lists. */
  function compareByStart(a, b) {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  /** Output order: by where the overlap begins, then ends, then ids. */
  function compareConflicts(a, b) {
    if (a.overlapStart !== b.overlapStart) return a.overlapStart - b.overlapStart;
    if (a.overlapEnd !== b.overlapEnd) return a.overlapEnd - b.overlapEnd;
    if (a.eventA !== b.eventA) return a.eventA < b.eventA ? -1 : 1;
    return a.eventB < b.eventB ? -1 : a.eventB > b.eventB ? 1 : 0;
  }

  /** Conflict record for two overlapping items; `first` sorts before `second`. */
  function makeConflict(first, second) {
    const overlapStart = Math.max(first.start, second.start);
    const overlapEnd = Math.min(first.end, second.end);
    return Object.freeze({
      eventA: first.id,
      eventB: second.id,
      overlapStart,
      overlapEnd,
      overlapMinutes: overlapEnd - overlapStart,
    });
  }

  /**
   * Every overlapping pair among `items`, with the overlap measured.
   * Does not change `items`. Already-sorted input (from the day index)
   * makes the sort nearly free.
   */
  function detectConflicts(items) {
    const sorted = items.slice().sort(compareByStart);
    const active = new MinHeap((it) => it.end); // started, not yet ended
    const out = [];

    for (const x of sorted) {
      // Drop everything that ended at or before x starts (touching is not a clash).
      while (active.size > 0 && active.peek().end <= x.start) active.pop();
      // Everything left started no later than x and ends after x starts: a real overlap.
      for (const y of active) out.push(makeConflict(y, x));
      active.push(x);
    }

    out.sort(compareConflicts); // stable, readable order for the UI and tests: O(k log k)
    return out;
  }

  /**
   * Conflicts between one item and a list, in O(n). Used while dragging,
   * where only the moved event needs checking against its day.
   * The item itself (same id) is skipped if it is in the list.
   */
  function conflictsFor(target, items) {
    const out = [];
    for (const other of items) {
      if (other.id === target.id) continue;
      if (other.start < target.end && target.start < other.end) {
        out.push(compareByStart(other, target) <= 0 ? makeConflict(other, target) : makeConflict(target, other));
      }
    }
    out.sort(compareConflicts);
    return out;
  }

  /** Conflicts from a list that involve the given event id. */
  function conflictsInvolving(conflicts, id) {
    return conflicts.filter((c) => c.eventA === id || c.eventB === id);
  }

  return { detectConflicts, conflictsFor, conflictsInvolving, compareConflicts };
});
