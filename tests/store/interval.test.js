"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Interval } = require("../../store/interval.js");
const { m } = require("../helpers.js");

test("rejects start >= end and non-integers", () => {
  assert.throws(() => new Interval(600, 600), RangeError);
  assert.throws(() => new Interval(660, 600), RangeError);
  assert.throws(() => new Interval(600.5, 660), TypeError);
  assert.throws(() => new Interval("600", 660), TypeError);
});

test("accepts a whole day and a 1-minute interval", () => {
  assert.equal(new Interval(0, 1440).length(), 1440);
  assert.equal(new Interval(0, 1).length(), 1);
});

test("is frozen", () => {
  const iv = new Interval(0, 10);
  assert.throws(() => { iv.start = 5; }, TypeError);
});

test("overlaps: one test per equivalence class", () => {
  const a = new Interval(m("10:00"), m("11:00"));
  const cases = [
    ["disjoint",  new Interval(m("12:00"), m("13:00")), false],
    ["touching after", new Interval(m("11:00"), m("12:00")), false],
    ["touching before", new Interval(m("09:00"), m("10:00")), false],
    ["partial",   new Interval(m("10:30"), m("12:00")), true],
    ["nested",    new Interval(m("10:15"), m("10:45")), true],
    ["contains",  new Interval(m("09:00"), m("12:00")), true],
    ["identical", new Interval(m("10:00"), m("11:00")), true],
  ];
  for (const [name, b, expected] of cases) {
    assert.equal(a.overlaps(b), expected, name);
    assert.equal(b.overlaps(a), expected, name + " (reversed)");
  }
});

test("overlaps works on plain {start, end} objects", () => {
  assert.equal(new Interval(0, 10).overlaps({ start: 5, end: 20 }), true);
});

test("overlapWith measures shared minutes", () => {
  const a = new Interval(m("10:00"), m("11:30"));
  assert.equal(a.overlapWith(new Interval(m("11:00"), m("12:00"))), 30);
  assert.equal(a.overlapWith(new Interval(m("10:15"), m("10:45"))), 30);
  assert.equal(a.overlapWith(new Interval(m("11:30"), m("12:00"))), 0);
  assert.equal(a.overlapWith(new Interval(m("13:00"), m("14:00"))), 0);
});

test("intersect clips to the other interval, or returns null", () => {
  const window = new Interval(m("09:00"), m("18:00"));
  assert.ok(new Interval(m("08:00"), m("10:00")).intersect(window).equals(new Interval(m("09:00"), m("10:00"))));
  assert.ok(new Interval(m("17:00"), m("19:00")).intersect(window).equals(new Interval(m("17:00"), m("18:00"))));
  assert.equal(new Interval(m("18:00"), m("19:00")).intersect(window), null);
  assert.equal(new Interval(m("07:00"), m("08:00")).intersect(window), null);
});

test("contains includes start and excludes end", () => {
  const a = new Interval(10, 20);
  assert.equal(a.contains(9), false);
  assert.equal(a.contains(10), true);
  assert.equal(a.contains(19), true);
  assert.equal(a.contains(20), false);
});
