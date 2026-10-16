"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { detectConflicts, conflictsFor, conflictsInvolving, compareConflicts } = require("../../conflict/detectConflicts.js");
const { EventStore } = require("../../store/eventStore.js");
const { m, ev, rng } = require("../helpers.js");

const iv = (id, s, e) => ({ id, start: m(s), end: m(e) });

/** Brute-force oracle: test every pair. O(n^2), obviously correct. */
function bruteForce(items) {
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.start < b.end && b.start < a.end) {
        const s = Math.max(a.start, b.start), e = Math.min(a.end, b.end);
        out.push({ pair: [a.id, b.id].sort().join("|"), overlapStart: s, overlapEnd: e, overlapMinutes: e - s });
      }
    }
  }
  return out.sort((x, y) => (x.pair < y.pair ? -1 : x.pair > y.pair ? 1 : 0));
}
const normalise = (conflicts) => conflicts
  .map((c) => ({ pair: [c.eventA, c.eventB].sort().join("|"), overlapStart: c.overlapStart,
    overlapEnd: c.overlapEnd, overlapMinutes: c.overlapMinutes }))
  .sort((x, y) => (x.pair < y.pair ? -1 : x.pair > y.pair ? 1 : 0));

test("empty day and a single event have no conflicts", () => {
  assert.deepEqual(detectConflicts([]), []);
  assert.deepEqual(detectConflicts([iv("a", "10:00", "11:00")]), []);
});

test("T1: touching events do not conflict", () => {
  assert.deepEqual(detectConflicts([iv("a", "09:00", "10:00"), iv("b", "10:00", "11:00")]), []);
});

test("T2: nested event is flagged with a 60-minute overlap", () => {
  const out = detectConflicts([iv("big", "09:00", "12:00"), iv("small", "10:00", "11:00")]);
  assert.deepEqual(out, [{ eventA: "big", eventB: "small", overlapStart: m("10:00"), overlapEnd: m("11:00"), overlapMinutes: 60 }]);
});

test("partial overlap reports where it starts and ends (for the shading)", () => {
  const out = detectConflicts([iv("lecture", "10:00", "11:30"), iv("ta", "11:00", "12:00")]);
  assert.deepEqual(out, [{ eventA: "lecture", eventB: "ta", overlapStart: m("11:00"), overlapEnd: m("11:30"), overlapMinutes: 30 }]);
});

test("identical events conflict for their full length", () => {
  const out = detectConflicts([iv("a", "10:00", "11:00"), iv("b", "10:00", "11:00")]);
  assert.equal(out.length, 1);
  assert.equal(out[0].overlapMinutes, 60);
});

test("three-way overlap reports all three pairs", () => {
  const out = detectConflicts([iv("a", "10:00", "12:00"), iv("b", "10:30", "11:30"), iv("c", "11:00", "13:00")]);
  assert.deepEqual(normalise(out).map((c) => [c.pair, c.overlapMinutes]),
    [["a|b", 60], ["a|c", 60], ["b|c", 30]]);
});

test("a chain of touching events plus one spanning them", () => {
  const out = detectConflicts([iv("a", "09:00", "10:00"), iv("b", "10:00", "11:00"),
    iv("c", "11:00", "12:00"), iv("long", "09:30", "11:30")]);
  assert.deepEqual(normalise(out).map((c) => c.pair), ["a|long", "b|long", "c|long"]);
});

test("unsorted input works and is not changed", () => {
  const items = [iv("c", "14:00", "15:00"), iv("a", "09:00", "12:00"), iv("b", "10:00", "11:00")];
  const copy = items.map((x) => ({ ...x }));
  assert.equal(detectConflicts(items).length, 1);
  assert.deepEqual(items, copy);
});

test("works directly on store.eventsOn(day)", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "lecture", start: m("10:00"), end: m("11:30") }));
  s.addEvent(ev({ id: "ta", start: m("11:00"), end: m("12:00") }));
  s.addEvent(ev({ id: "lab", start: m("14:00"), end: m("16:00") }));
  const out = detectConflicts(s.eventsOn("2026-10-14"));
  assert.equal(out.length, 1);
  assert.equal(out[0].overlapMinutes, 30);
});

test("full overlap: n events all on top of each other give n(n-1)/2 pairs", () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: "e" + i, start: 600, end: 700 }));
  assert.equal(detectConflicts(items).length, (20 * 19) / 2);
});

test("matches the brute-force oracle on random seeded days", () => {
  const rand = rng(2026);
  for (let round = 0; round < 300; round++) {
    const n = Math.floor(rand() * 30);
    const items = Array.from({ length: n }, (_, i) => {
      const start = Math.floor(rand() * 1400);
      return { id: "e" + i, start, end: Math.min(1440, start + 1 + Math.floor(rand() * 180)) };
    });
    assert.deepEqual(normalise(detectConflicts(items)), bruteForce(items), "round " + round);
  }
});

test("output is in a stable order", () => {
  const out = detectConflicts([iv("a", "10:00", "12:00"), iv("b", "10:30", "11:30"), iv("c", "11:00", "13:00")]);
  const resorted = out.slice().sort(compareConflicts);
  assert.deepEqual(out, resorted);
});

test("conflictsFor: quick check of one event while dragging", () => {
  const day = [iv("a", "09:00", "10:00"), iv("b", "10:30", "11:30"), iv("moving", "08:00", "08:30")];
  const proposed = { id: "moving", start: m("09:45"), end: m("10:45") };
  const out = conflictsFor(proposed, day);
  assert.deepEqual(normalise(out).map((c) => [c.pair, c.overlapMinutes]), [["a|moving", 15], ["b|moving", 15]]);
  assert.deepEqual(conflictsFor({ id: "moving", start: m("10:00"), end: m("10:30") }, day), []); // touches both
});

test("conflictsFor agrees with detectConflicts on random days", () => {
  const rand = rng(99);
  for (let round = 0; round < 200; round++) {
    const items = Array.from({ length: 15 }, (_, i) => {
      const start = Math.floor(rand() * 1300);
      return { id: "e" + i, start, end: start + 15 + Math.floor(rand() * 120) };
    });
    const target = items[Math.floor(rand() * items.length)];
    assert.deepEqual(normalise(conflictsFor(target, items)),
      normalise(conflictsInvolving(detectConflicts(items), target.id)));
  }
});

test("conflictsInvolving filters by event id", () => {
  const all = detectConflicts([iv("a", "10:00", "12:00"), iv("b", "10:30", "11:30"), iv("c", "13:00", "14:00"), iv("d", "13:30", "14:30")]);
  assert.deepEqual(conflictsInvolving(all, "c").map((c) => c.eventB), ["d"]);
  assert.deepEqual(conflictsInvolving(all, "zzz"), []);
});
