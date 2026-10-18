"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../../application/validation.js");

const form = (o = {}) => ({ title: "Meeting with TA", date: "2026-10-14", start: "11:00", end: "12:00", priority: "medium", ...o });
const fields = (r) => r.errors.map((e) => e.field);

test("parseClock: valid, boundaries and junk", () => {
  assert.equal(V.parseClock("09:30"), 570);
  assert.equal(V.parseClock("0:00"), 0);
  assert.equal(V.parseClock("24:00"), 1440);
  for (const bad of ["24:01", "25:00", "12:60", "", "noon", "9.30", null, undefined, -1, 1441]) {
    assert.equal(V.parseClock(bad), null, String(bad));
  }
});

test("a good event form gives store-ready minutes", () => {
  const r = V.validateEventForm(form({ category: "meeting" }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.value, { title: "Meeting with TA", day: "2026-10-14", start: 660, end: 720,
    description: "", priority: "medium", category: "meeting" });
});

test("T5 / ER1: end before start gives the A3 message on the end field", () => {
  const r = V.validateEventForm(form({ start: "13:00", end: "12:00" }));
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [{ code: "ER1", field: "end",
    message: "End time is before the start. Set it after 13:00, on the same day." }]);
});

test("ER1: equal times, impossible times, missing fields", () => {
  assert.deepEqual(fields(V.validateEventForm(form({ end: "11:00" }))), ["end"]);
  assert.deepEqual(fields(V.validateEventForm(form({ start: "25:00" }))), ["start"]);
  assert.deepEqual(fields(V.validateEventForm(form({ start: "24:00", end: "24:00" }))), ["start"]);
  assert.deepEqual(fields(V.validateEventForm(form({ title: "  " }))), ["title"]);
  assert.deepEqual(fields(V.validateEventForm(form({ date: "2026-02-30" }))), ["date"]);
  assert.deepEqual(fields(V.validateEventForm(form({ priority: "urgent" }))), ["priority"]);
  assert.deepEqual(fields(V.validateEventForm(form({ category: "party" }))), ["category"]);
  assert.ok(V.validateEventForm({}).errors.length >= 4);
});

test("an event may end at 24:00", () => {
  assert.equal(V.validateEventForm(form({ start: "23:00", end: "24:00" })).value.end, 1440);
});

test("task form: duration as text, optional deadline needs both parts", () => {
  const ok = V.validateTaskForm({ name: "Write viva notes", duration: "90", priority: "high",
    deadlineDate: "2026-10-16", deadlineTime: "17:00" });
  assert.deepEqual(ok.value, { name: "Write viva notes", duration: 90, priority: "high", deadline: { day: "2026-10-16", minute: 1020 } });
  assert.equal(V.validateTaskForm({ name: "x", duration: 30, priority: "low" }).value.deadline, null);
  assert.deepEqual(fields(V.validateTaskForm({ name: "x", duration: 0, priority: "low" })), ["duration"]);
  assert.deepEqual(fields(V.validateTaskForm({ name: "x", duration: 30, priority: "low", deadlineTime: "17:00" })), ["deadlineDate"]);
  assert.deepEqual(fields(V.validateTaskForm({ name: "x", duration: 30, priority: "low", deadlineDate: "2026-10-16" })), ["deadlineTime"]);
});

test("window form defaults to working hours", () => {
  assert.deepEqual(V.validateWindowForm({ date: "2026-10-15" }).value, { day: "2026-10-15", start: 540, end: 1080 });
  assert.equal(V.validateWindowForm({ date: "2026-10-15", start: "17:00", end: "16:00" }).ok, false);
});

test("breaks are parsed and checked", () => {
  assert.deepEqual(V.validateBreaks([{ start: "13:00", end: "14:00" }]).value, [{ start: 780, end: 840 }]);
  assert.equal(V.validateBreaks([{ start: "14:00", end: "13:00" }]).ok, false);
});

test("clampDrag: snaps to 15 and stops at the 15-minute minimum without an error", () => {
  assert.deepEqual(V.clampDrag({ start: 600, end: 610 }), { start: 600, end: 615, clamped: true }); // T8
  assert.deepEqual(V.clampDrag({ start: 607, end: 668 }), { start: 600, end: 675, clamped: false });
  assert.deepEqual(V.clampDrag({ start: 600, end: 590 }), { start: 600, end: 615, clamped: true });
  assert.deepEqual(V.clampDrag({ start: 1435, end: 1500 }), { start: 1425, end: 1440, clamped: false });
  // end rounds down onto the start (10:07 -> 10:00): must still come out 15 minutes long
  assert.deepEqual(V.clampDrag({ start: 600, end: 607 }), { start: 600, end: 615, clamped: true });
});
