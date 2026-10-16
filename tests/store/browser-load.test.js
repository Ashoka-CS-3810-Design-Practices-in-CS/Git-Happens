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

const ORDER = ["store/interval.js", "store/records.js", "store/eventStore.js"];

test("store files load as plain browser scripts and attach to window.SS", () => {
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
});
