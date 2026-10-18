"use strict";
/**
 * White-box tests for branches the feature tests did not reach
 * (found with: npm run test:coverage).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { App } = require("../../application/app.js");
const { UndoHistory } = require("../../application/history.js");
const { EventStore } = require("../../store/eventStore.js");
const { Interval } = require("../../store/interval.js");
const R = require("../../store/records.js");
const { Persistence, fromSaveFormat, PersistenceError } = require("../../store/persistence.js");
const { findBestSlots } = require("../../scheduling/findBestSlots.js");

const THU = "2026-10-15";
const form = (o = {}) => ({ title: "Event", date: THU, start: "10:00", end: "11:00", priority: "medium", ...o });
function newApp() {
  const store = new EventStore();
  const app = new App(store);
  app.start();
  return { store, app };
}

test("undo of create removes the event", () => {
  const { app, store } = newApp();
  const ev = app.createEvent(form()).event;
  assert.equal(app.undo().message, "Undone: Add Event");
  assert.equal(store.getEvent(ev.id), null);
});

test("undo of create task removes the task", () => {
  const { app, store } = newApp();
  const t = app.createTask({ name: "Gym", duration: 60, priority: "low" }).task;
  app.undo();
  assert.equal(store.getTask(t.id), null);
});

test("undo of deleting a scheduled task's event re-links the task", () => {
  const { app, store } = newApp();
  const t = app.createTask({ name: "Gym", duration: 60, priority: "low" }).task;
  const ev = app.acceptSlot(t.id, app.findTimes(t.id, { date: THU }).recommendations[0]).event;
  app.deleteEvent(ev.id);
  assert.equal(store.getTask(t.id).status, "unplaced");
  app.undo();
  assert.equal(store.getTask(t.id).status, "scheduled");
  assert.equal(store.getTask(t.id).scheduledEventId, ev.id);
});

test("findAnotherTime: ER4 on a full day, ER1 on a bad window", () => {
  const { app } = newApp();
  app.createEvent(form({ title: "All day", start: "09:00", end: "18:00" }));
  const clash = app.createEvent(form({ title: "Clash", start: "12:00", end: "13:00" })).event;
  assert.equal(app.findAnotherTime(clash.id).error.code, "ER4");
  assert.equal(app.findAnotherTime(clash.id, { date: THU, start: "12:00", end: "11:00" }).errors[0].code, "ER1");
  assert.equal(app.findAnotherTime("nope").errors[0].code, "NOT_FOUND");
});

test("findTimes: bad breaks are ER1", () => {
  const { app } = newApp();
  const t = app.createTask({ name: "x", duration: 30, priority: "low" }).task;
  assert.equal(app.findTimes(t.id, { date: THU }, { breaks: [{ start: "14:00", end: "13:00" }] }).errors[0].field, "breaks");
});

test("a window exactly as long as the task is allowed (ER3 boundary)", () => {
  const recs = findBestSlots({ duration: 60, priority: "low" }, { day: THU, start: 600, end: 660 }, []);
  assert.deepEqual(recs[0].slot, { start: 600, end: 660 });
});

test("findBestSlots rejects malformed windows and breaks as programming errors", () => {
  const t = { duration: 30, priority: "low" };
  assert.throws(() => findBestSlots(t, { day: THU, start: 600, end: 500 }, []), TypeError);
  assert.throws(() => findBestSlots(t, null, []), TypeError);
  assert.throws(() => findBestSlots(t, { day: THU, start: 540, end: 1080 }, [], { breaks: [{ start: 5, end: 1 }] }), TypeError);
});

test("UndoHistory drops the oldest entry past its limit", () => {
  const h = new UndoHistory(2);
  h.push("one", () => []);
  h.push("two", () => []);
  h.push("three", () => []);
  assert.equal(h.pop().label, "three");
  assert.equal(h.pop().label, "two");
  assert.equal(h.pop(), null);
});

test("Interval.toString", () => {
  assert.equal(String(new Interval(10, 20)), "[10, 20)");
});

test("records: remaining guard branches", () => {
  const base = { title: "x", day: THU, start: 1, end: 2, priority: "low" };
  assert.throws(() => R.createEvent({ ...base, sourceTaskId: 5 }), (e) => e.field === "sourceTaskId");
  assert.throws(() => R.createTask({ name: "x", duration: 5, priority: "low", deadline: { day: THU, minute: 2000 } }), (e) => e.field === "deadline");
  assert.throws(() => R.createTask({ name: "x", duration: 5, priority: "low", status: "done" }), (e) => e.field === "status");
});

test("persistence: non-object save data and a failing serializer", () => {
  assert.throws(() => fromSaveFormat([1, 2]), (e) => e instanceof PersistenceError && e.code === "BAD_FORMAT");
  const brokenStore = { toData() { throw new Error("boom"); } };
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const r = new Persistence(brokenStore, { storage }).saveNow();
  assert.equal(r.error.reason, "SERIALIZE");
});
