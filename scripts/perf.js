/**
 * scripts/perf.js   (run with: npm run perf)
 *
 * Performance testing (Assignment 3 section 3 and section 4):
 *   1. Scaling: the algorithms on 100 -> 100,000 intervals, median of 20 runs,
 *      to confirm n log n growth (not n^2).
 *   2. Targets: with 500 events, one edit < 500 ms, and a full recheck of
 *      every day plus a scheduling search < 1 s.
 *
 * Intervals are spread along a long timeline with a few overlaps each,
 * like a real calendar, so the number of conflicts k stays close to n.
 */
"use strict";
const { detectConflicts } = require("../conflict/detectConflicts.js");
const { mergeIntervals, complement } = require("../scheduling/intervals.js");
const { EventStore } = require("../store/eventStore.js");
const { App } = require("../application/app.js");

const RUNS = 20;

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function makeIntervals(n, seed = 1) {
  const rand = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const start = i * 30 + Math.floor(rand() * 20);
    return { id: "e" + i, start, end: start + 20 + Math.floor(rand() * 30) };
  });
}

function median(fn) {
  for (let w = 0; w < 5; w++) fn(); // warm-up, so the JIT compiler doesn't skew small timings
  const times = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)];
}

function scaling() {
  const sizes = [100, 1000, 10000, 100000];
  const rows = [];
  for (const n of sizes) {
    const items = makeIntervals(n);
    const window = { start: 0, end: items[items.length - 1].end + 60 };
    const merged = mergeIntervals(items);
    rows.push({
      n,
      conflicts: median(() => detectConflicts(items)),
      merge: median(() => mergeIntervals(items)),
      complement: median(() => complement(merged, window)),
      k: detectConflicts(items).length,
    });
  }
  console.log("1. Scaling (median of 20 runs, milliseconds)\n");
  console.log("        n | sweep-line |   merge | complement |      k");
  for (const r of rows) {
    console.log(`${String(r.n).padStart(9)} | ${r.conflicts.toFixed(3).padStart(10)} | ${r.merge.toFixed(3).padStart(7)} | ${r.complement.toFixed(3).padStart(10)} | ${String(r.k).padStart(6)}`);
  }
  // Growth from 10,000 to 100,000 (10x more data):
  //   n log n predicts about 12.5x more time, n^2 would be 100x.
  const a = rows[2], b = rows[3];
  const nlogn = (b.n * Math.log2(b.n)) / (a.n * Math.log2(a.n));
  console.log(`\nGrowth 10,000 -> 100,000: sweep-line x${(b.conflicts / a.conflicts).toFixed(1)}, merge x${(b.merge / a.merge).toFixed(1)}, complement x${(b.complement / a.complement).toFixed(1)} (linear, predicts x10)`);
  console.log(`n log n predicts x${nlogn.toFixed(1)}; quadratic would be x100.`);
}

function targets() {
  const store = new EventStore();
  const app = new App(store);
  app.start();
  const days = Array.from({ length: 25 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  for (let i = 0; i < 500; i++) {
    const start = 480 + (i % 20) * 30;
    store.addEvent({ title: "E" + i, day: days[i % 25], start, end: start + 45, priority: "low" });
  }

  const edit = median(() => {
    const r = app.createEvent({ title: "New", date: days[3], start: "12:00", end: "13:00", priority: "low" });
    app.deleteEvent(r.event.id);
  }) / 2;

  const task = app.createTask({ name: "Study", duration: 60, priority: "high" }).task;
  const full = median(() => {
    store.invalidateAll();
    for (const d of store.days()) detectConflicts(store.eventsOn(d));
    app.findTimes(task.id, { date: days[3] });
  });

  console.log("\n2. Targets with 500 events\n");
  console.log(`One edit (validate, save, recheck, render):  ${edit.toFixed(3)} ms   target < 500 ms   ${edit < 500 ? "PASS" : "FAIL"}`);
  console.log(`Full recheck of all days + scheduling:       ${full.toFixed(3)} ms   target < 1000 ms  ${full < 1000 ? "PASS" : "FAIL"}`);
}

scaling();
targets();
