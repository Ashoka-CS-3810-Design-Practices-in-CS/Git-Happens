"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventStore, StoreError, compareEvents } = require("../../store/eventStore.js");
const { m, ev, rng } = require("../helpers.js");

const MON = "2026-10-12";
const TUE = "2026-10-13";

test("add and get by id", () => {
  const s = new EventStore();
  const e = s.addEvent(ev({ id: "a" }));
  assert.equal(s.getEvent("a"), e);
  assert.equal(s.getEvent("missing"), null);
  assert.equal(s.size, 1);
});

test("duplicate id is rejected", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a" }));
  assert.throws(() => s.addEvent(ev({ id: "a" })), (e) => e instanceof StoreError && e.code === "DUPLICATE_ID");
});

test("a rejected add leaves the store unchanged", () => {
  const s = new EventStore();
  assert.throws(() => s.addEvent(ev({ end: m("09:00") })));
  assert.equal(s.size, 0);
  assert.deepEqual(s.days(), []);
});

test("eventsOn is sorted by start whatever the insertion order", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "c", start: m("14:00"), end: m("15:00") }));
  s.addEvent(ev({ id: "a", start: m("09:00"), end: m("10:00") }));
  s.addEvent(ev({ id: "b", start: m("10:00"), end: m("11:30") }));
  assert.deepEqual(s.eventsOn("2026-10-14").map((e) => e.id), ["a", "b", "c"]);
});

test("eventsOn returns a copy", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a" }));
  s.eventsOn("2026-10-14").pop();
  assert.equal(s.eventsOn("2026-10-14").length, 1);
  assert.deepEqual(s.eventsOn("2026-01-01"), []);
});

test("update on the same day re-sorts the list", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a", start: m("09:00"), end: m("10:00") }));
  s.addEvent(ev({ id: "b", start: m("11:00"), end: m("12:00") }));
  s.updateEvent("a", { start: m("13:00"), end: m("14:00") });
  assert.deepEqual(s.eventsOn("2026-10-14").map((e) => e.id), ["b", "a"]);
});

test("moving to another day updates both day lists and returns before/after", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a", day: MON }));
  const { before, after } = s.updateEvent("a", { day: TUE });
  assert.equal(before.day, MON);
  assert.equal(after.day, TUE);
  assert.deepEqual(s.eventsOn(MON), []);
  assert.deepEqual(s.eventsOn(TUE).map((e) => e.id), ["a"]);
  assert.deepEqual(s.days(), [TUE]);
});

test("a rejected update changes nothing", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a" }));
  assert.throws(() => s.updateEvent("a", { end: m("09:00") }));
  assert.throws(() => s.updateEvent("a", { id: "b" }));
  assert.throws(() => s.updateEvent("zzz", { title: "x" }), (e) => e.code === "NOT_FOUND");
  assert.equal(s.getEvent("a").end, m("11:00"));
});

test("remove returns the event and empties the day", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a" }));
  assert.equal(s.removeEvent("a").id, "a");
  assert.equal(s.removeEvent("a"), null);
  assert.equal(s.size, 0);
  assert.deepEqual(s.days(), []);
});

test("eventsIn returns overlapping events and skips touching ones and other days", () => {
  const s = new EventStore();
  const day = "2026-10-15";
  s.addEvent(ev({ id: "before",  day, start: m("08:00"), end: m("09:00") })); // touches window start
  s.addEvent(ev({ id: "partial", day, start: m("08:30"), end: m("09:30") }));
  s.addEvent(ev({ id: "inside",  day, start: m("12:00"), end: m("13:00") }));
  s.addEvent(ev({ id: "after",   day, start: m("18:00"), end: m("19:00") })); // touches window end
  s.addEvent(ev({ id: "other",   day: TUE, start: m("12:00"), end: m("13:00") }));
  const ids = s.eventsIn({ day, start: m("09:00"), end: m("18:00") }).map((e) => e.id);
  assert.deepEqual(ids, ["partial", "inside"]);
  assert.throws(() => s.eventsIn({ day, start: m("18:00"), end: m("09:00") }), (e) => e.code === "BAD_WINDOW");
});

test("cache: put/get, and dropped for every day an event change touches", () => {
  const s = new EventStore();
  s.putBusy(MON, ["blocks"]);
  s.putRecommendations(MON, ["recs"]);
  s.putBusy(TUE, ["blocks"]);
  assert.deepEqual(s.getBusy(MON), ["blocks"]);
  assert.deepEqual(s.getRecommendations(MON), ["recs"]);

  s.addEvent(ev({ id: "a", day: MON }));
  assert.equal(s.getBusy(MON), undefined);
  assert.equal(s.getRecommendations(MON), undefined);
  assert.deepEqual(s.getBusy(TUE), ["blocks"]); // other days untouched

  s.putBusy(MON, ["x"]);
  s.updateEvent("a", { day: TUE }); // both days dropped
  assert.equal(s.getBusy(MON), undefined);
  assert.equal(s.getBusy(TUE), undefined);

  s.putBusy(TUE, ["y"]);
  s.removeEvent("a");
  assert.equal(s.getBusy(TUE), undefined);
});

test("tasks: add, list unplaced, mark scheduled", () => {
  const s = new EventStore();
  const t = s.addTask({ id: "t1", name: "Write viva notes", duration: 90, priority: "high" });
  s.addTask({ id: "t2", name: "Read notes", duration: 45, priority: "medium" });
  assert.equal(s.unplacedTasks().length, 2);

  const placed = s.addEvent({ title: t.name, day: MON, start: m("09:00"), end: m("10:30"),
    priority: "high", sourceTaskId: "t1" });
  s.updateTask("t1", { status: "scheduled", scheduledEventId: placed.id });
  assert.deepEqual(s.unplacedTasks().map((x) => x.id), ["t2"]);
  assert.equal(s.removeTask("t2").id, "t2");
  assert.equal(s.removeTask("t2"), null);
});

test("toData / loadData round trip", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "a", day: TUE }));
  s.addEvent(ev({ id: "b", day: MON }));
  s.addTask({ id: "t1", name: "Gym", duration: 60, priority: "low" });
  const copy = new EventStore();
  copy.loadData(JSON.parse(JSON.stringify(s.toData())));
  assert.deepEqual(copy.allEvents().map((e) => e.id), ["b", "a"]);
  assert.equal(copy.getTask("t1").name, "Gym");
});

test("loadData is all-or-nothing", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "keep" }));
  assert.throws(() => s.loadData({ events: [ev({ id: "x" }), ev({ id: "bad", end: m("01:00") })], tasks: [] }));
  assert.throws(() => s.loadData(null), (e) => e.code === "BAD_DATA");
  assert.deepEqual(s.allEvents().map((e) => e.id), ["keep"]);
});

test("random operations match a simple array model", () => {
  const rand = rng(42);
  const days = ["2026-10-12", "2026-10-13", "2026-10-14"];
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const randomTimes = () => {
    const start = Math.floor(rand() * 1380);
    return { start, end: start + 15 + Math.floor(rand() * 45) };
  };

  const s = new EventStore();
  const model = new Map();
  for (let i = 0; i < 2000; i++) {
    const op = rand();
    const ids = Array.from(model.keys());
    if (op < 0.5 || ids.length === 0) {
      const e = s.addEvent(ev({ id: "e" + i, day: pick(days), ...randomTimes() }));
      model.set(e.id, e);
    } else if (op < 0.8) {
      const { after } = s.updateEvent(pick(ids), { day: pick(days), ...randomTimes() });
      model.set(after.id, after);
    } else {
      const id = pick(ids);
      s.removeEvent(id);
      model.delete(id);
    }
  }

  assert.equal(s.size, model.size);
  for (const day of days) {
    const expected = Array.from(model.values()).filter((e) => e.day === day).sort(compareEvents);
    assert.deepEqual(s.eventsOn(day).map((e) => e.id), expected.map((e) => e.id), day);
  }
});
