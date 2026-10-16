"use strict";
/**
 * MC/DC (Modified Condition/Decision Coverage) for the compound conditions
 * in the algorithms: each condition is shown to change the outcome on its
 * own, with the other conditions held fixed (Assignment 3 section 3).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { Interval } = require("../../store/interval.js");
const { fragments } = require("../../scheduling/findBestSlots.js");
const { detectConflicts } = require("../../conflict/detectConflicts.js");
const { mergeIntervals, complement } = require("../../scheduling/intervals.js");

test("MC/DC overlaps: A = a.start < b.end, B = b.start < a.end; decision A && B (3 cases, not 4)", () => {
  const a = new Interval(10, 20);
  // case | A | B | result
  //  1   | T | T | true   (baseline)
  //  2   | F | T | false  (only A changed vs 1 -> A matters)
  //  3   | T | F | false  (only B changed vs 1 -> B matters)
  assert.equal(a.overlaps({ start: 15, end: 25 }), true);
  assert.equal(new Interval(30, 40).overlaps({ start: 15, end: 25 }), false);
  assert.equal(a.overlaps({ start: 25, end: 35 }), false);
});

test("MC/DC fragmentation filter: (0 < rb && rb < 15) || (0 < ra && ra < 15)", () => {
  const gap = { start: 0, end: 100 };
  const slot = (rb, ra) => ({ start: gap.start + rb, end: gap.end - ra });
  // case | 0<rb | rb<15 | 0<ra | ra<15 | result
  //  1   |  T   |  T    |  F   |  T    | true    baseline for the left side
  //  2   |  F   |  T    |  F   |  T    | false   0<rb matters (1 vs 2)
  //  3   |  T   |  F    |  F   |  T    | false   rb<15 matters (1 vs 3)
  //  4   |  F   |  T    |  T   |  T    | true    baseline for the right side
  //  5   |  F   |  T    |  F   |  T    | false   0<ra matters (4 vs 5, same as case 2)
  //  6   |  F   |  T    |  T   |  F    | false   ra<15 matters (4 vs 6)
  assert.equal(fragments(slot(10, 0), gap, 15), true);
  assert.equal(fragments(slot(0, 0), gap, 15), false);
  assert.equal(fragments(slot(20, 0), gap, 15), false);
  assert.equal(fragments(slot(0, 10), gap, 15), true);
  assert.equal(fragments(slot(0, 20), gap, 15), false);
  // boundary: exactly 15 left over is allowed, 14 is not
  assert.equal(fragments(slot(15, 0), gap, 15), false);
  assert.equal(fragments(slot(14, 0), gap, 15), true);
});

test("sweep eviction: active.size > 0 && peek().end <= x.start", () => {
  // size > 0 false: first interval never evicts anything -> no conflicts from one item
  assert.deepEqual(detectConflicts([{ id: "a", start: 0, end: 10 }]), []);
  // end <= start true (touching, equal): evicted, no conflict
  assert.deepEqual(detectConflicts([{ id: "a", start: 0, end: 10 }, { id: "b", start: 10, end: 20 }]), []);
  // end <= start false by one minute: kept, conflict of 1 minute
  assert.equal(detectConflicts([{ id: "a", start: 0, end: 11 }, { id: "b", start: 10, end: 20 }])[0].overlapMinutes, 1);
});

test("merge condition x.start <= last.end: touching merges, a one-minute gap does not", () => {
  assert.deepEqual(mergeIntervals([{ start: 0, end: 10 }, { start: 10, end: 20 }]), [{ start: 0, end: 20 }]);
  assert.deepEqual(mergeIntervals([{ start: 0, end: 10 }, { start: 11, end: 20 }]), [{ start: 0, end: 10 }, { start: 11, end: 20 }]);
});

test("complement: b.start > cursor emits a gap only when there really is one", () => {
  const w = { start: 0, end: 30 };
  assert.deepEqual(complement([{ start: 0, end: 10 }], w), [{ start: 10, end: 30 }]); // block at cursor: no empty gap
  assert.deepEqual(complement([{ start: 1, end: 10 }], w), [{ start: 0, end: 1 }, { start: 10, end: 30 }]); // one-minute gap
});
