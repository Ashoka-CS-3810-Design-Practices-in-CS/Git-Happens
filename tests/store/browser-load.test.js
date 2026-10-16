"use strict";
/**
 * Loads the store files the way the browser does (plain scripts sharing one
 * global, no module/require) to make sure double-clicking index.html works.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ORDER = ["store/interval.js", "store/records.js", "store/eventStore.js", "store/persistence.js",
  "conflict/minHeap.js", "conflict/detectConflicts.js",
  "scheduling/intervals.js", "scheduling/scoring.js", "scheduling/findBestSlots.js",
  "application/validation.js", "application/history.js", "application/app.js"];

test("all scripts load as plain browser scripts and attach to window.SS", () => {
  const context = vm.createContext({});
  context.window = context;
  for (const file of ORDER) {
    const code = fs.readFileSync(path.join(__dirname, "..", "..", file), "utf8");
    vm.runInContext(code, context, { filename: file });
  }
  const { EventStore, Interval, createEvent } = context.SS;
  assert.equal(typeof EventStore, "function");
  assert.equal(typeof Interval, "function");
  const s = new EventStore();
  s.addEvent(createEvent({ title: "x", day: "2026-10-14", start: 600, end: 660, priority: "low" }));
  assert.equal(s.size, 1);

  // persistence loads too; with no localStorage in this context it reports unavailable
  const p = new context.SS.Persistence(s);
  assert.equal(p.load().status, "unavailable");

  // conflict detection loads too
  s.addEvent(createEvent({ title: "y", day: "2026-10-14", start: 630, end: 700, priority: "low" }));
  assert.equal(context.SS.detectConflicts(s.eventsOn("2026-10-14")).length, 1);

  // scheduling loads too
  const recs = context.SS.findBestSlotsInStore(s, { duration: 60, priority: "low", deadline: null },
    { day: "2026-10-14", start: 540, end: 1080 });
  assert.ok(recs.length > 0);

  // the application layer loads too
  const app = new context.SS.App(new EventStore());
  app.start();
  assert.equal(app.createEvent({ title: "z", date: "2026-10-14", start: "10:00", end: "11:00", priority: "low" }).ok, true);
});
