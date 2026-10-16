"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");
const { newCalendar, reopenedWith } = require("./api.js");
 
const MON = "2026-10-12", TUE = "2026-10-13", THU = "2026-10-15";
 
test("T1: day has 09:00–10:00; adding 10:00–11:00 is saved with no conflict", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: THU, start: "09:00", end: "10:00" });
  const r = c.addEvent({ title: "B", day: THU, start: "10:00", end: "11:00" });
  assert.equal(r.ok, true);
  assert.equal(c.conflictsOn(THU).length, 0);
});
 
test("T2: day has 09:00–12:00; adding 10:00–11:00 is saved and flagged with a 60 min overlap (ER2)", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: THU, start: "09:00", end: "12:00" });
  const r = c.addEvent({ title: "B", day: THU, start: "10:00", end: "11:00" });
  assert.equal(r.ok, true, "ER2 never blocks");
  assert.equal(c.eventsOn(THU).length, 2, "both events are kept");
  assert.equal(c.conflictsOn(THU)[0].overlapMinutes, 60);
});
 
test("T3: events 10:00–11:00, 10:30–12:00, 14:00–15:00 leave gaps 09:00–10:00, 12:00–14:00, 15:00–18:00", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: THU, start: "10:00", end: "11:00" });
  c.addEvent({ title: "B", day: THU, start: "10:30", end: "12:00" });
  c.addEvent({ title: "C", day: THU, start: "14:00", end: "15:00" });
  assert.deepEqual(c.freeGaps({ day: THU, start: 540, end: 1080 }), [{ start: 540, end: 600 }, { start: 720, end: 840 }, { start: 900, end: 1080 }]);
});
 
test("T4: a 60 min task whose only gap is 13:00–14:00 gets 13:00–14:00 with an explanation", () => {
  const c = newCalendar();
  c.addEvent({ title: "Morning", day: THU, start: "09:00", end: "13:00" });
  c.addEvent({ title: "Afternoon", day: THU, start: "14:00", end: "18:00" });
  const r = c.findTimes({ name: "Task", duration: 60, window: { day: THU, start: "09:00", end: "18:00" } });
  assert.equal(r.ok, true);
  assert.equal(r.recommendations[0].slot.start, 780);
  assert.equal(r.recommendations[0].slot.end, 840);
  assert.ok(r.recommendations[0].reason.length > 0);
});

test("T5: an event from 10:00 to 09:00 is rejected as ER1 on the end field and nothing is saved", () => {
  const c = newCalendar();
  const r = c.addEvent({ title: "Bad", day: THU, start: "10:00", end: "09:00" });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].code, "ER1");
  assert.equal(r.errors[0].field, "end");
  assert.ok(r.errors[0].message.length > 0);
  assert.equal(c.eventsOn(THU).length, 0);
});
 
test("T6: a 120 min task with window 14:00–15:00 is rejected as too short (ER3)", () => {
  const c = newCalendar();
  const r = c.findTimes({ name: "Long", duration: 120, window: { day: THU, start: "14:00", end: "15:00" } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, "ER3");
});
 
test("T7: moving a conflicting event from Monday to Tuesday clears Monday's conflict", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: MON, start: "10:00", end: "11:00" });
  const b = c.addEvent({ title: "B", day: MON, start: "10:30", end: "11:30" }).event;
  assert.equal(c.conflictsOn(MON).length, 1);
  c.change(b.id, { day: TUE });
  assert.equal(c.conflictsOn(MON).length, 0);
  assert.equal(c.conflictsOn(TUE).length, 0);
});
 
test("T8: dragging the end of 10:00–11:00 up to 10:10 stops at 10:00–10:15, with no error, and rechecks the day", () => {
  const c = newCalendar();
  const a = c.addEvent({ title: "A", day: THU, start: "10:00", end: "11:00" }).event;
  c.addEvent({ title: "B", day: THU, start: "10:20", end: "10:40" });
  assert.equal(c.conflictsOn(THU).length, 1);
  const r = c.drag(a.id, { end: 610 });
  assert.equal(r.ok, true, "no error box");
  assert.equal(r.clamped, true, "the Minimum 15 min hint shows");
  assert.equal(c.get(a.id).end, 615);
  assert.equal(c.conflictsOn(THU).length, 0, "conflict detection re-ran for that day");
});
 
test("T9: with 500 events, adding one finishes in under 500 ms", () => {
  const c = newCalendar();
  const events = [];
  for (let i = 0; i < 500; i++) {
    const day = "2026-10-" + String(1 + (i % 28)).padStart(2, "0");
    const start = 480 + (i % 40) * 15;
    events.push({ id: "ev_" + i, title: "E" + i, day, start, end: start + 45, description: "", priority: "low", category: "class", sourceTaskId: null });
  }
  c.loadData({ events, tasks: [] });
  const t0 = performance.now();
  c.addEvent({ title: "New", day: THU, start: "12:00", end: "13:00" });
  assert.ok(performance.now() - t0 < 500);
});
 
 
test("ER1: impossible times are rejected and nothing changes", () => {
  const c = newCalendar();
  for (const [start, end] of [["25:00", "26:00"], ["10:00", "10:00"], ["ten", "11:00"], ["", "11:00"], ["10:00", "10:61"]]) {
    const r = c.addEvent({ title: "X", day: THU, start, end });
    assert.equal(r.ok, false, start + "–" + end);
    assert.equal(r.errors[0].code, "ER1");
  }
  assert.equal(c.eventsOn(THU).length, 0);
});
 
test("ER1 on edit: an invalid change through the form leaves the event as it was", () => {
  const c = newCalendar();
  const a = c.addEvent({ title: "A", day: THU, start: "10:00", end: "11:00" }).event;
  assert.equal(c.change(a.id, { end: "09:00" }).ok, false);
  assert.equal(c.get(a.id).end, 660);
});
 
test("ER2: an overlap is flagged on create and on move, and both events stay", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: THU, start: "10:00", end: "11:00" });
  const b = c.addEvent({ title: "B", day: THU, start: "12:00", end: "13:00" }).event;
  const r = c.change(b.id, { start: "10:30", end: "11:30" });
  assert.equal(r.ok, true);
  assert.equal(r.conflicts.length, 1);
  assert.equal(c.eventsOn(THU).length, 2);
});
 
test("ER3: the window is checked before anything else", () => {
  const c = newCalendar();
  const r = c.findTimes({ name: "T", duration: 90, window: { day: THU, start: "16:00", end: "17:00" } });
  assert.equal(r.error.code, "ER3");
  assert.equal(r.error.message, "The window 16:00 – 17:00 is 1h, but the task needs 1h 30m.");
});
 
test("ER4: no free slot gives the no-slot message and the closest miss", () => {
  const c = newCalendar();
  c.addEvent({ title: "Busy", day: THU, start: "09:00", end: "13:45" });
  c.addEvent({ title: "Busy 2", day: THU, start: "15:00", end: "18:00" });
  const r = c.findTimes({ name: "T", duration: 90, window: { day: THU, start: "09:00", end: "18:00" } });
  assert.equal(r.error.code, "ER4");
  assert.match(r.error.message, /^No free 1h 30m on .+ between 09:00 and 18:00\.$/);
  const gap = r.error.data.longestGap;
  assert.deepEqual({ start: gap.start, end: gap.end }, { start: 825, end: 900 });
});
 
// ---------------- invalid input ----------------
 
test("an empty title is rejected on the title field", () => {
  const r = newCalendar().addEvent({ title: "   ", day: THU, start: "10:00", end: "11:00" });
  assert.equal(r.errors[0].field, "title");
});
 
test("an unknown priority is rejected on the priority field", () => {
  const r = newCalendar().addEvent({ title: "A", day: THU, start: "10:00", end: "11:00", priority: "urgent" });
  assert.equal(r.errors[0].field, "priority");
});
 
test("a task with zero or negative duration is rejected", () => {
  const c = newCalendar();
  assert.equal(c.addTask({ name: "T", duration: 0 }).ok, false);
  assert.equal(c.addTask({ name: "T", duration: -30 }).ok, false);
});
 
test("corrupt saved data opens an empty calendar with a warning", () => {
  for (const text of ["{oops", "null", JSON.stringify({ version: 1, events: "x", tasks: [] })]) {
    const { cal, result } = reopenedWith(text);
    assert.ok(result.warning, "a warning is shown for " + text);
    assert.equal(cal.eventsOn(THU).length, 0);
  }
});
 
 
test("Flow C: accepting a slot puts the task on the calendar and takes it off the unplaced list", () => {
  const c = newCalendar();
  const t = c.addTask({ name: "Viva notes", duration: 90, priority: "high" }).task;
  assert.equal(c.unplaced().length, 1);
  const r = c.findTimes({ taskId: t.id, window: { day: THU, start: "09:00", end: "18:00" } });
  const placed = c.accept(t.id, r.recommendations[0]);
  assert.equal(placed.ok, true);
  assert.equal(c.eventsOn(THU)[0].title, "Viva notes");
  assert.equal(c.unplaced().length, 0);
  assert.ok(r.recommendations.length <= 3, "at most three suggestions");
});
 
test("Flow D: deleting an event clears any clash it was part of", () => {
  const c = newCalendar();
  c.addEvent({ title: "A", day: THU, start: "10:00", end: "11:00" });
  const b = c.addEvent({ title: "B", day: THU, start: "10:30", end: "11:30" }).event;
  c.remove(b.id);
  assert.equal(c.conflictsOn(THU).length, 0);
});
 
test("Undo reverses a delete", () => {
  const c = newCalendar();
  const a = c.addEvent({ title: "Gym", day: THU, start: "17:30", end: "18:30" }).event;
  c.remove(a.id);
  c.undo();
  assert.equal(c.get(a.id).title, "Gym");
});
 
test("events cannot cross midnight", () => {
  const r = newCalendar().addEvent({ title: "Night", day: THU, start: "23:00", end: "01:00" });
  assert.equal(r.ok, false);
});
 