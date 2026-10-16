
//   store -> conflict check -> free gaps -> ranking -> save -> render
// with a fake renderer that records what it was asked to redraw and what it would show.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const SS = Object.assign({},
  require("../../store/eventStore.js"),
  require("../../store/persistence.js"),
  require("../../application/app.js"));
const Service = require("../../presentation/service.js");
 
const MON = "2026-10-12", TUE = "2026-10-13", THU = "2026-10-15";
 
function fakeStorage() {
  const data = new Map();
  return { data, getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

function setup(storage) {
  const calls = [];
  const timers = [];
  const store = new SS.EventStore();
  const persistence = new SS.Persistence(store, {
    storage: storage || fakeStorage(),
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {}
  });
  let s = null;
  const render = (days, info) => calls.push({
    info,
    days: days.map((d) => ({ day: d, events: s.eventsOn(d).map((e) => e.title), flagged: [...s.conflictedIds(d)].sort() }))
  });
  const app = new SS.App(store, { persistence, render });
  s = Service.create({ app, persistence });
  const loaded = app.start();
  return { s, app, loaded, calls, last: () => calls[calls.length - 1].days, flushSaves: () => timers.splice(0).forEach((fn) => fn()) };
}
 
test("deleting a clash partner clears the flag on the one left behind", () => {
  const { s, last } = setup();
  const a = s.createEvent({ title: "Lecture", day: THU, start: 600, end: 690 }).event;
  const b = s.createEvent({ title: "TA", day: THU, start: 660, end: 720 }).event;
  assert.deepEqual(last()[0].flagged, [a.id, b.id].sort());
  s.deleteEvent(b.id);
  assert.deepEqual(last(), [{ day: THU, events: ["Lecture"], flagged: [] }]);
});
 
test("T7: moving an event across days redraws and rechecks both days in one render", () => {
  const { s, last } = setup();
  s.createEvent({ title: "A", day: MON, start: 600, end: 660 });
  const b = s.createEvent({ title: "B", day: MON, start: 630, end: 700 }).event;
  s.createEvent({ title: "C", day: TUE, start: 600, end: 660 });
  s.updateEvent(b.id, { day: TUE });
  assert.deepEqual(last().map((x) => x.day), [MON, TUE]);
  assert.deepEqual(last()[0].flagged, [], "Monday's clash is gone");
  assert.equal(last()[1].flagged.length, 2, "Tuesday now has the clash");
});
 
test("dragging snaps to 15 minutes, stops at 15 minutes long and never errors", () => {
  const { s } = setup();
  const a = s.createEvent({ title: "A", day: THU, start: 600, end: 660 }).event;
  const r = s.updateEvent(a.id, { end: 610 }, { source: "drag" });
  assert.equal(r.ok, true);
  assert.equal(r.clamped, true);
  assert.equal(s.getEvent(a.id).end, 615);
  assert.deepEqual(s.clampDrag(607, 668), { start: 600, end: 675, clamped: false });
});
 
test("the editor's live check marks the right field", () => {
  const { s } = setup();
  const v = s.validateEvent({ title: "A", day: "2026-02-30", start: "10:00", end: "09:00" });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors.map((e) => e.field).sort(), ["day", "end"]);
});
 
test("Find a time on a new task saves it first, and accepting links the task and event both ways", () => {
  const { s, last } = setup();
  s.createEvent({ title: "Lecture", day: THU, start: 540, end: 690 });
  const res = s.findTimes({ name: "Write viva notes", duration: 90, priority: "high",
    deadline: { day: "2026-10-16", minute: "17:00" }, window: { day: THU, start: "09:00", end: "18:00" } });
  assert.equal(res.ok, true);
  assert.equal(res.recommendations[0].slot.day, THU, "cards know their day");
  assert.equal(s.unplacedTasks().length, 1);
  assert.equal(s.currentSearch().task.name, "Write viva notes");
  const placed = s.acceptSlot(res.taskId, res.recommendations[0]);
  assert.equal(placed.event.sourceTaskId, res.taskId);
  assert.equal(placed.task.scheduledEventId, placed.event.id);
  assert.equal(s.unplacedTasks().length, 0);
  assert.equal(s.currentSearch(), null, "the search closes once a slot is taken");
  assert.ok(last()[0].events.includes("Write viva notes"));
});
 
test("changing the duration in Find a time replaces the task instead of adding a second one", () => {
  const { s } = setup();
  const first = s.findTimes({ name: "Read", duration: 120, priority: "medium", window: { day: THU, start: "14:00", end: "15:00" } });
  assert.equal(first.error.code, "ER3");
  const again = s.findTimes({ taskId: first.taskId, name: "Read", duration: 60, priority: "medium", window: { day: THU, start: "14:00", end: "15:00" } });
  assert.equal(again.ok, true);
  assert.equal(s.unplacedTasks().length, 1);
  assert.equal(s.unplacedTasks()[0].duration, 60);
});
 
test("ER4 reads as a sentence with the day written out, and keeps the closest miss", () => {
  const { s } = setup();
  s.createEvent({ title: "Busy", day: THU, start: "09:00", end: "13:45" });
  s.createEvent({ title: "Busy 2", day: THU, start: "15:00", end: "18:00" });
  const r = s.findTimes({ name: "T", duration: 90, priority: "low", window: { day: THU, start: "09:00", end: "18:00" } });
  assert.equal(r.error.message, "No free 1h 30m on Thu 15 Oct between 09:00 and 18:00.");
  assert.equal(r.error.data.longestGap.start, 825);
});
 
test("an open search is refreshed when its day changes, and closing it hides it", () => {
  const { s, calls } = setup();
  const r = s.findTimes({ name: "T", duration: 60, priority: "low", window: { day: THU, start: "09:00", end: "18:00" } });
  const best = r.recommendations[0].slot;
  s.createEvent({ title: "Taken", day: THU, start: best.start, end: best.end });
  assert.equal(calls[calls.length - 1].info.searchRefreshed, true);
  assert.notDeepEqual(s.currentSearch().result.recommendations[0].slot, best, "the taken time is no longer offered");
  s.closeSearch();
  assert.equal(s.currentSearch(), null);
});
 
test("Find another time on a clash offers only free times, and moving there clears the clash", () => {
  const { s } = setup();
  s.createEvent({ title: "Lecture", day: THU, start: 600, end: 690 });
  const ta = s.createEvent({ title: "TA", day: THU, start: 660, end: 720 }).event;
  const alt = s.findAnotherTime(ta.id);
  assert.equal(alt.ok, true);
  assert.equal(s.moveToSlot(ta.id, alt.recommendations[0].slot).ok, true);
  assert.equal(s.conflictsOn(THU).length, 0);
});
 
test("deleting a placed task's event puts the task back in Unplaced, and undo reverses it", () => {
  const { s } = setup();
  const r = s.findTimes({ name: "Viva", duration: 60, priority: "high", window: { day: THU, start: "09:00", end: "18:00" } });
  const placed = s.acceptSlot(r.taskId, r.recommendations[0]);
  const del = s.deleteEvent(placed.event.id);
  assert.equal(del.task.name, "Viva");
  assert.equal(s.unplacedTasks().length, 1);
  assert.equal(s.undo().label, "Delete Viva");
  assert.equal(s.unplacedTasks().length, 0);
});
 
test("a change is saved after the pause, and reopening gives the same calendar", () => {
  const storage = fakeStorage();
  const { s, flushSaves } = setup(storage);
  s.createEvent({ title: "Lecture", day: THU, start: 600, end: 690 });
  assert.equal(storage.data.size, 0, "not saved on every change");
  flushSaves();
  const again = setup(storage);
  assert.equal(again.loaded.status, "loaded");
  assert.equal(again.s.eventsOn(THU)[0].title, "Lecture");
});
 
test("the demo calendar loads, has its planned clashes and no damaged data", () => {
  const data = require("../../samples/demo-calendar.json");
  const { s, calls } = setup();
  assert.equal(s.loadData(data).ok, true);
  assert.equal(calls[calls.length - 1].info.type, "import");
  assert.equal(s.conflictsOn("2026-10-14").length, 1, "DPCS lecture and Meeting with TA");
  assert.equal(s.conflictsOn("2026-10-16").length, 0, "back-to-back is not a clash");
  assert.equal(s.conflictsOn("2026-10-20").length, 3, "three-way overlap");
  assert.equal(s.unplacedTasks().length, 3);
  const r = s.findTimes({ name: "x", duration: 60, priority: "low", window: { day: "2026-10-19", start: "09:00", end: "18:00" } });
  assert.equal(r.error.code, "ER4", "the hackathon fills Mon 19");
});
 
test("a bad import file changes nothing", () => {
  const { s } = setup();
  s.createEvent({ title: "Keep me", day: THU, start: 600, end: 660 });
  const r = s.importCalendar("{not json");
  assert.equal(r.ok, false);
  assert.ok(r.error.message.length > 0);
  assert.equal(s.eventsOn(THU)[0].title, "Keep me");
});
 