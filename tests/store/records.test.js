"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../../store/records.js");
const { m, ev } = require("../helpers.js");

test("createEvent builds a frozen event with an id", () => {
  const e = R.createEvent(ev({ title: "  DPCS lecture  " }));
  assert.ok(e.id.startsWith("ev_"));
  assert.equal(e.title, "DPCS lecture");
  assert.equal(e.sourceTaskId, null);
  assert.ok(Object.isFrozen(e));
});

test("missing or empty category defaults to personal task (FR2)", () => {
  assert.equal(R.createEvent(ev()).category, "personal task");
  assert.equal(R.createEvent(ev({ category: "" })).category, "personal task");
  assert.equal(R.createEvent(ev({ category: "class" })).category, "class");
});

test("createEvent rejects bad fields and names the field", () => {
  const bad = [
    [{ title: "   " }, "title"],
    [{ priority: "urgent" }, "priority"],
    [{ priority: undefined }, "priority"],
    [{ category: "party" }, "category"],
    [{ day: "2026-02-30" }, "day"],
    [{ day: "14/10/2026" }, "day"],
    [{ start: m("11:00"), end: m("10:00") }, "time"],
    [{ start: m("10:00"), end: m("10:00") }, "time"],
    [{ start: -1 }, "time"],
    [{ end: 1441 }, "time"],
    [{ start: 600.5 }, "time"],
  ];
  for (const [overrides, field] of bad) {
    assert.throws(() => R.createEvent(ev(overrides)), (err) => err instanceof R.RecordError && err.field === field,
      JSON.stringify(overrides));
  }
});

test("day boundaries 0 and 1440 are allowed", () => {
  assert.doesNotThrow(() => R.createEvent(ev({ start: 0, end: 1 })));
  assert.doesNotThrow(() => R.createEvent(ev({ start: 1439, end: 1440 })));
});

test("isDayKey handles leap years", () => {
  assert.equal(R.isDayKey("2028-02-29"), true);
  assert.equal(R.isDayKey("2026-02-29"), false);
  assert.equal(R.isDayKey("2026-13-01"), false);
});

test("withChanges keeps the id, rechecks, and does not touch the original", () => {
  const e = R.createEvent(ev());
  const moved = R.withChanges(e, { start: m("12:00"), end: m("13:00") });
  assert.equal(moved.id, e.id);
  assert.equal(moved.start, m("12:00"));
  assert.equal(e.start, m("10:00"));
  assert.throws(() => R.withChanges(e, { id: "other" }), R.RecordError);
  assert.throws(() => R.withChanges(e, { end: m("09:00") }), R.RecordError);
});

test("eventInterval projects an event to an Interval", () => {
  const iv = R.eventInterval(R.createEvent(ev()));
  assert.equal(iv.start, m("10:00"));
  assert.equal(iv.length(), 60);
});

test("createTask defaults to unplaced and checks its fields", () => {
  const t = R.createTask({ name: "Write viva notes", duration: 90, priority: "high",
    deadline: { day: "2026-10-16", minute: m("17:00") } });
  assert.equal(t.status, "unplaced");
  assert.equal(t.window, null);
  assert.ok(Object.isFrozen(t.deadline));

  assert.throws(() => R.createTask({ name: "x", duration: 0, priority: "low" }), R.RecordError);
  assert.throws(() => R.createTask({ name: "", duration: 30, priority: "low" }), R.RecordError);
  assert.throws(() => R.createTask({ name: "x", duration: 30, priority: "low", status: "scheduled" }), R.RecordError);
  assert.throws(() => R.createTask({ name: "x", duration: 30, priority: "low", scheduledEventId: "ev_1" }), R.RecordError);
  assert.throws(() => R.createTask({ name: "x", duration: 30, priority: "low",
    window: { day: "2026-10-15", start: m("17:00"), end: m("16:00") } }), R.RecordError);
});

test("a window shorter than the task is allowed here (ER3 is checked by findBestSlots)", () => {
  assert.doesNotThrow(() => R.createTask({ name: "x", duration: 120, priority: "low",
    window: { day: "2026-10-15", start: m("14:00"), end: m("15:00") } }));
});

test("toEvent turns an accepted slot into a linked personal task event", () => {
  const t = R.createTask({ name: "Gym", duration: 60, priority: "low" });
  const e = R.toEvent(t, "2026-10-16", { start: m("17:30"), end: m("18:30") });
  assert.equal(e.title, "Gym");
  assert.equal(e.category, "personal task");
  assert.equal(e.sourceTaskId, t.id);
  assert.equal(e.priority, "low");
});
