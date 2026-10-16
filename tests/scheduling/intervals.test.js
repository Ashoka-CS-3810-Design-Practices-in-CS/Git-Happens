"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeIntervals, complement, clipToWindow } = require("../../scheduling/intervals.js");
const { m, rng } = require("../helpers.js");

const iv = (s, e) => ({ start: m(s), end: m(e) });

/** Oracle: a 1,440-minute busy array. */
function busyArray(intervals) {
  const a = new Array(1440).fill(false);
  for (const x of intervals) for (let t = x.start; t < x.end; t++) a[t] = true;
  return a;
}
function runs(arr, value, from = 0, to = 1440) {
  const out = [];
  let t = from;
  while (t < to) {
    if (arr[t] === value) {
      const s = t;
      while (t < to && arr[t] === value) t++;
      out.push({ start: s, end: t });
    } else t++;
  }
  return out;
}
function randomIntervals(rand, n) {
  return Array.from({ length: n }, () => {
    const start = Math.floor(rand() * 1400);
    return { start, end: Math.min(1440, start + 1 + Math.floor(rand() * 200)) };
  });
}

test("merge: empty input", () => {
  assert.deepEqual(mergeIntervals([]), []);
});

test("merge: overlapping, nested, touching and identical are fused; disjoint kept", () => {
  const out = mergeIntervals([iv("14:00", "15:00"), iv("10:00", "11:00"), iv("10:30", "12:00"),
    iv("10:45", "11:15"), iv("12:00", "12:30"), iv("16:00", "17:00"), iv("16:00", "17:00")]);
  assert.deepEqual(out, [iv("10:00", "12:30"), iv("14:00", "15:00"), iv("16:00", "17:00")]);
});

test("merge does not change its input", () => {
  const input = [iv("10:00", "11:00"), iv("10:30", "12:00")];
  const copy = input.map((x) => ({ ...x }));
  mergeIntervals(input);
  assert.deepEqual(input, copy);
});

test("T3: merge then complement gives the free gaps", () => {
  const busy = mergeIntervals([iv("10:00", "11:00"), iv("10:30", "12:00"), iv("14:00", "15:00")]);
  assert.deepEqual(complement(busy, iv("09:00", "18:00")),
    [iv("09:00", "10:00"), iv("12:00", "14:00"), iv("15:00", "18:00")]);
});

test("complement: empty day is one gap, fully booked is none", () => {
  assert.deepEqual(complement([], iv("09:00", "18:00")), [iv("09:00", "18:00")]);
  assert.deepEqual(complement([iv("08:00", "19:00")], iv("09:00", "18:00")), []);
  assert.deepEqual(complement([iv("09:00", "18:00")], iv("09:00", "18:00")), []);
});

test("complement: blocks sticking out of the window, or outside it", () => {
  const w = iv("09:00", "18:00");
  assert.deepEqual(complement([iv("07:00", "08:00"), iv("08:30", "10:00"), iv("17:00", "20:00")], w), [iv("10:00", "17:00")]);
  assert.deepEqual(complement([iv("18:00", "19:00")], w), [w]);
});

test("clipToWindow trims and drops", () => {
  assert.deepEqual(clipToWindow([iv("08:00", "10:00"), iv("18:00", "19:00"), iv("12:00", "13:00")], iv("09:00", "18:00")),
    [iv("09:00", "10:00"), iv("12:00", "13:00")]);
});

test("merge matches the busy-array oracle on random input", () => {
  const rand = rng(11);
  for (let r = 0; r < 200; r++) {
    const input = randomIntervals(rand, Math.floor(rand() * 25));
    assert.deepEqual(mergeIntervals(input), runs(busyArray(input), true));
  }
});

test("complement matches the oracle, and busy + free = window", () => {
  const rand = rng(12);
  for (let r = 0; r < 200; r++) {
    const input = randomIntervals(rand, Math.floor(rand() * 25));
    const ws = Math.floor(rand() * 1000);
    const w = { start: ws, end: ws + 1 + Math.floor(rand() * (1440 - ws - 1)) };
    const free = complement(mergeIntervals(input), w);
    assert.deepEqual(free, runs(busyArray(input), false, w.start, w.end));

    const busyInWindow = clipToWindow(mergeIntervals(input), w);
    const total = [...free, ...busyInWindow].reduce((s, x) => s + (x.end - x.start), 0);
    assert.equal(total, w.end - w.start);
  }
});
