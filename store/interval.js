/**
 * store/interval.js
 *
 * Interval: a half-open time interval [start, end) in integer minutes.
 *
 * Rules (Assignment 2, section 4.1):
 *   - start and end are integers, and start < end.
 *   - The interval includes start but not end, so 09:00-10:00 and
 *     10:00-11:00 share an endpoint but do NOT overlap.
 *   - Intervals are immutable (frozen) once created.
 *
 * All operations are O(1).
 *
 * Works in two places without changes:
 *   - Browser (plain <script> tag): attaches to window.SS
 *   - Node (tests): module.exports
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

  class Interval {
    /**
     * @param {number} start  integer minutes
     * @param {number} end    integer minutes, must be > start
     */
    constructor(start, end) {
      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        throw new TypeError(`Interval bounds must be integers, got [${start}, ${end})`);
      }
      if (start >= end) {
        throw new RangeError(`Interval needs start < end, got [${start}, ${end})`);
      }
      this.start = start;
      this.end = end;
      Object.freeze(this);
    }

    /** Number of minutes covered. */
    length() {
      return this.end - this.start;
    }

    /**
     * True if the two intervals share at least one minute.
     * Touching intervals (a.end === b.start) do not overlap.
     * `other` can be any object with start and end (e.g. an Event).
     */
    overlaps(other) {
      return this.start < other.end && other.start < this.end;
    }

    /** Minutes shared with `other`; 0 if they do not overlap. */
    overlapWith(other) {
      return Math.max(0, Math.min(this.end, other.end) - Math.max(this.start, other.start));
    }

    /**
     * The part of this interval inside `other`, or null if there is none.
     * Used to clip events to a scheduling window.
     */
    intersect(other) {
      const s = Math.max(this.start, other.start);
      const e = Math.min(this.end, other.end);
      return s < e ? new Interval(s, e) : null;
    }

    /** True if minute t falls inside: start <= t < end. */
    contains(t) {
      return this.start <= t && t < this.end;
    }

    equals(other) {
      return other != null && this.start === other.start && this.end === other.end;
    }

    toString() {
      return `[${this.start}, ${this.end})`;
    }
  }

  return { Interval };
});
