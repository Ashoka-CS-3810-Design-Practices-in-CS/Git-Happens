"use strict";
/**
 * Integration tests: store -> conflict check -> free gaps -> ranking -> render,
 * with a stub renderer and a stub persistence (Assignment 3 section 3).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { App, dayLabel } = require("../../application/app.js");
const { EventStore } = require("../../store/eventStore.js");
const { Persistence } = require("../../store/persistence.js");

const MON = "2026-10-12";
const TUE = "2026-10-13";
const THU = "2026-10-15";

function setup() {
  const store = new EventStore();
  const renders = [];
  let saves = 0;
  const persistence = { load: () => ({ status: "empty" }), scheduleSave: () => { saves++; } };
  const app = new App(store, { persistence, render: (days, info) => renders.push({ days, info }) });
  app.start();
  renders.length = 0;
  return { store, app, renders, saves: () => saves };
}
const form = (o = {}) => ({ title: "Event", date: MON, start: "10:00", end: "11:00", priority: "medium", ...o });

test("dayLabel", () => {
  assert.equal(dayLabel("2026-10-15"), "Thu 15");
});

test("Flow A: create without a clash -> saved, rendered, saved to storage", () => {
  const { app, store, renders, saves } = setup();
  const r = app.createEvent(form({ title: "DPCS lecture" }));
  assert.equal(r.ok, true);
  assert.equal(r.message, "Event added");
  assert.deepEqual(r.conflicts, []);
  assert.equal(store.size, 1);
  assert.deepEqual(renders.map((x) => x.days), [[MON]]);
  assert.equal(saves(), 1);
});

test("T2 / ER2: a clash is kept, reported, and alternatives are offered", () => {
  const { app, store } = setup();
  app.createEvent(form({ title: "DPCS lecture", start: "10:00", end: "11:30" }));
  const r = app.createEvent(form({ title: "Meeting with TA", start: "11:00", end: "12:00" }));
  assert.equal(r.ok, true);
  assert.equal(store.size, 2);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].overlapMinutes, 30);
  assert.ok(r.alternatives.length > 0);
  assert.deepEqual(app.daysWithConflicts(), [MON]);
});

test("T5 / ER1: bad form -> errors, store unchanged, nothing rendered or saved", () => {
  const { app, store, renders, saves } = setup();
  const r = app.createEvent(form({ start: "10:00", end: "09:00" }));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "ER1");
  assert.equal(store.size, 0);
  assert.equal(renders.length, 0);
  assert.equal(saves(), 0);
});

test("T7: moving a conflicting event from Monday to Tuesday clears Monday's conflict", () => {
  const { app } = setup();
  app.createEvent(form({ title: "A" }));
  const b = app.createEvent(form({ title: "B", start: "10:30", end: "11:30" })).event;
  assert.equal(app.conflictsOn(MON).length, 1);
  const r = app.moveEvent(b.id, { day: TUE, start: 630, end: 690 });
  assert.equal(r.ok, true);
  assert.deepEqual(app.conflictsOn(MON), []);
  assert.deepEqual(app.conflictsOn(TUE), []);
  assert.equal(r.message, "Moved to Tue 13, 10:30 – 11:30");
});

test("a move re-renders both the old and the new day", () => {
  const { app, renders } = setup();
  const a = app.createEvent(form()).event;
  renders.length = 0;
  app.moveEvent(a.id, { day: TUE, start: 600, end: 660 });
  assert.deepEqual(renders[0].days.sort(), [MON, TUE]);
});

test("T8: dragging the bottom edge to 10:10 stops at 10:15, no error, conflicts rechecked", () => {
  const { app, store } = setup();
  const ev = app.createEvent(form({ start: "10:00", end: "11:00" })).event;
  const r = app.moveEvent(ev.id, { start: 600, end: 610 });
  assert.equal(r.ok, true);
  assert.equal(r.clamped, true);
  assert.equal(store.getEvent(ev.id).end, 615);
});

test("dragPreview checks only the moved event and saves nothing", () => {
  const { app, store, saves } = setup();
  app.createEvent(form({ title: "A", start: "10:00", end: "11:00" }));
  const b = app.createEvent(form({ title: "B", start: "12:00", end: "13:00" })).event;
  const before = saves();
  const p = app.dragPreview(b.id, { start: 630, end: 690 });
  assert.equal(p.conflicts.length, 1);
  assert.equal(store.getEvent(b.id).start, 720);
  assert.equal(saves(), before);
});

test("editing via the form validates (ER1) and leaves the event unchanged on failure", () => {
  const { app, store } = setup();
  const ev = app.createEvent(form()).event;
  assert.equal(app.updateEvent(ev.id, form({ end: "09:00" })).ok, false);
  assert.equal(store.getEvent(ev.id).end, 660);
  const ok = app.updateEvent(ev.id, form({ title: "Renamed", start: "14:00", end: "15:00" }));
  assert.equal(ok.message, "Event updated");
  assert.equal(store.getEvent(ev.id).title, "Renamed");
});

test("Flow D: deleting a conflict partner clears the flag", () => {
  const { app } = setup();
  const a = app.createEvent(form({ title: "A" })).event;
  app.createEvent(form({ title: "B", start: "10:30", end: "11:30" }));
  const r = app.deleteEvent(a.id);
  assert.equal(r.message, "Deleted A");
  assert.deepEqual(app.conflictsOn(MON), []);
  assert.deepEqual(app.daysWithConflicts(), []);
});

test("unknown ids give NOT_FOUND instead of throwing", () => {
  const { app } = setup();
  assert.equal(app.deleteEvent("nope").errors[0].code, "NOT_FOUND");
  assert.equal(app.moveEvent("nope", { start: 0, end: 60 }).errors[0].code, "NOT_FOUND");
  assert.equal(app.findTimes("nope", { date: THU }).errors[0].code, "NOT_FOUND");
});

test("Flow C: create task, find times, accept a slot -> event created and linked", () => {
  const { app, store } = setup();
  app.createEvent(form({ title: "Algorithms lecture", date: THU, start: "10:00", end: "11:30" }));
  const t = app.createTask({ name: "Write viva notes", duration: 90, priority: "high" });
  assert.equal(t.ok, true);
  assert.equal(store.unplacedTasks().length, 1);

  const found = app.findTimes(t.task.id, { date: THU }, { breaks: [{ start: "13:00", end: "14:00" }] });
  assert.equal(found.ok, true);
  assert.ok(found.recommendations.length > 0 && found.recommendations.length <= 3);

  const best = found.recommendations[0];
  const r = app.acceptSlot(t.task.id, best);
  assert.equal(r.ok, true);
  assert.equal(r.message, "Write viva notes scheduled");
  assert.equal(r.event.sourceTaskId, t.task.id);
  assert.equal(store.getTask(t.task.id).status, "scheduled");
  assert.equal(store.getTask(t.task.id).scheduledEventId, r.event.id);
  assert.equal(store.unplacedTasks().length, 0);
  assert.equal(app.openSearch, null);
  assert.equal(app.acceptSlot(t.task.id, best).errors[0].code, "ALREADY_SCHEDULED");
});

test("ER3 and ER4 come back as error objects with data for the fixes", () => {
  const { app } = setup();
  const t = app.createTask({ name: "Long task", duration: 120, priority: "low" }).task;
  const er3 = app.findTimes(t.id, { date: THU, start: "14:00", end: "15:00" });
  assert.equal(er3.ok, false);
  assert.equal(er3.error.code, "ER3");
  assert.equal(er3.error.data.windowMinutes, 60);

  app.createEvent(form({ title: "Busy", date: THU, start: "09:00", end: "17:00" }));
  const er4 = app.findTimes(t.id, { date: THU });
  assert.equal(er4.error.code, "ER4");
  assert.deepEqual(er4.error.data.longestGap, { start: 1020, end: 1080 });
});

test("deleting a scheduled task's event puts the task back in Unplaced", () => {
  const { app, store } = setup();
  const t = app.createTask({ name: "Gym", duration: 60, priority: "low" }).task;
  const rec = app.findTimes(t.id, { date: THU }).recommendations[0];
  const ev = app.acceptSlot(t.id, rec).event;
  const r = app.deleteEvent(ev.id);
  assert.equal(r.taskReturned, true);
  assert.equal(store.getTask(t.id).status, "unplaced");
  assert.equal(store.getTask(t.id).scheduledEventId, null);
});

test("an open search is refreshed when its day changes", () => {
  const { app, renders } = setup();
  const t = app.createTask({ name: "Read notes", duration: 60, priority: "medium" }).task;
  const first = app.findTimes(t.id, { date: THU }).recommendations[0];
  assert.equal(first.slot.start, 540);
  renders.length = 0;
  app.createEvent(form({ title: "Now busy", date: THU, start: "09:00", end: "10:00" }));
  assert.equal(renders[0].info.searchRefreshed, true);
  assert.equal(app.openSearch.result.recommendations[0].slot.start, 600);
});

test("findAnotherTime suggests same-length slots that avoid the clash", () => {
  const { app } = setup();
  app.createEvent(form({ title: "DPCS lecture", date: THU, start: "10:00", end: "11:30" }));
  const ta = app.createEvent(form({ title: "Meeting with TA", date: THU, start: "11:00", end: "12:00" })).event;
  const r = app.findAnotherTime(ta.id);
  assert.equal(r.ok, true);
  for (const rec of r.recommendations) {
    assert.equal(rec.slot.end - rec.slot.start, 60);
    assert.ok(rec.slot.end <= 600 || rec.slot.start >= 690);
  }
});

test("undo reverses create, move, delete and accept, rechecking conflicts each time", () => {
  const { app, store } = setup();
  assert.equal(app.undo().ok, false);

  const a = app.createEvent(form({ title: "A" })).event;
  const b = app.createEvent(form({ title: "B", start: "10:30", end: "11:30" })).event;
  app.moveEvent(b.id, { day: TUE, start: 600, end: 660 });
  assert.deepEqual(app.conflictsOn(MON), []);

  assert.equal(app.undo().message, "Undone: Move B");
  assert.equal(store.getEvent(b.id).day, MON);
  assert.equal(app.conflictsOn(MON).length, 1);

  app.deleteEvent(a.id);
  assert.equal(app.undoLabel, "Delete A");
  app.undo();
  assert.equal(store.getEvent(a.id).title, "A");
  assert.equal(app.conflictsOn(MON).length, 1);

  const t = app.createTask({ name: "Gym", duration: 60, priority: "low" }).task;
  const ev = app.acceptSlot(t.id, app.findTimes(t.id, { date: THU }).recommendations[0]).event;
  app.undo();
  assert.equal(store.getEvent(ev.id), null);
  assert.equal(store.getTask(t.id).status, "unplaced");
});

test("deleting a scheduled task keeps its event but unlinks it; undo relinks", () => {
  const { app, store } = setup();
  const t = app.createTask({ name: "Gym", duration: 60, priority: "low" }).task;
  const ev = app.acceptSlot(t.id, app.findTimes(t.id, { date: THU }).recommendations[0]).event;
  app.deleteTask(t.id);
  assert.equal(store.getTask(t.id), null);
  assert.equal(store.getEvent(ev.id).sourceTaskId, null);
  app.undo();
  assert.equal(store.getEvent(ev.id).sourceTaskId, t.id);
});

test("start() loads saved data and computes conflicts for every day", () => {
  const storage = new Map();
  const fake = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  const s1 = new EventStore();
  const p1 = new Persistence(s1, { storage: fake });
  const app1 = new App(s1, { persistence: p1 });
  app1.start();
  app1.createEvent(form({ title: "A" }));
  app1.createEvent(form({ title: "B", start: "10:30", end: "11:30" }));
  p1.flush();

  const s2 = new EventStore();
  const app2 = new App(s2, { persistence: new Persistence(s2, { storage: fake }) });
  assert.equal(app2.start().status, "loaded");
  assert.equal(app2.conflictsOn(MON).length, 1);
});

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
}

test("import replaces the calendar, clears undo, and recomputes", () => {
  const s = new EventStore();
  const app = new App(s, { persistence: new Persistence(s, { storage: fakeStorage() }) });
  app.start();
  app.createEvent(form({ title: "A" }));
  app.createEvent(form({ title: "B", start: "10:30", end: "11:30" }));
  const text = app.exportCalendar();

  const s2 = new EventStore();
  const app2 = new App(s2, { persistence: new Persistence(s2, { storage: fakeStorage() }) });
  app2.start();
  const r = app2.importCalendar(text);
  assert.equal(r.ok, true);
  assert.equal(app2.conflictsOn(MON).length, 1);
  assert.equal(app2.canUndo, false);
  assert.equal(app2.importCalendar("not json").ok, false);
});

test("T9: with 500 events, adding one takes well under 500 ms", () => {
  const { app } = setup();
  const days = Array.from({ length: 25 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`);
  for (let i = 0; i < 500; i++) {
    const day = days[i % 25];
    const start = 480 + (i % 20) * 30;
    app.store.addEvent({ title: "E" + i, day, start, end: start + 45, priority: "low" });
  }
  const times = [];
  for (let run = 0; run < 20; run++) {
    const t0 = performance.now();
    const r = app.createEvent(form({ title: "New", date: days[run % 25], start: "12:00", end: "13:00" }));
    times.push(performance.now() - t0);
    app.deleteEvent(r.event.id);
  }
  times.sort((a, b) => a - b);
  const median = times[10];
  assert.ok(median < 500, `median ${median.toFixed(2)} ms`);
});
