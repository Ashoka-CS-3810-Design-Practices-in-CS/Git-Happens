"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { findBestSlots, findAlternativesFor, findBestSlotsInStore, SchedulingError } = require("../../scheduling/findBestSlots.js");
const { scoreSlot, DEFAULT_CONFIG } = require("../../scheduling/scoring.js");
const { EventStore } = require("../../store/eventStore.js");
const { m, ev, rng } = require("../helpers.js");

const DAY = "2026-10-15";
const W = { day: DAY, start: m("09:00"), end: m("18:00") };
const e = (id, s, t, title = id) => ({ id, title, start: m(s), end: m(t) });
const task = (duration, extra = {}) => ({ duration, priority: "medium", deadline: null, ...extra });
const isCode = (code) => (err) => err instanceof SchedulingError && err.code === code;

test("T6 / ER3: window shorter than the task", () => {
  assert.throws(() => findBestSlots(task(120), { day: DAY, start: m("14:00"), end: m("15:00") }, []),
    (err) => isCode("ER3")(err) && /needs 2h/.test(err.message) && err.data.windowMinutes === 60);
  assert.throws(() => findBestSlots(task(0), W, []), isCode("ER3"));
});

test("ER3 is raised before the store is read", () => {
  const trap = { getBusy() { throw new Error("read"); }, eventsOn() { throw new Error("read"); }, eventsIn() { throw new Error("read"); } };
  assert.throws(() => findBestSlotsInStore(trap, task(120), { day: DAY, start: m("14:00"), end: m("15:00") }), isCode("ER3"));
});

test("T4: exact fit in the only gap", () => {
  const events = [e("morning", "09:00", "13:00", "Lab"), e("afternoon", "14:00", "18:00", "Seminar")];
  const recs = findBestSlots(task(60), W, events);
  assert.equal(recs.length, 1);
  assert.deepEqual(recs[0].slot, { start: m("13:00"), end: m("14:00") });
  assert.equal(recs[0].boundedBefore, "morning");
  assert.equal(recs[0].boundedAfter, "afternoon");
  assert.match(recs[0].reason, /starts as Lab ends/);
  assert.match(recs[0].reason, /fills the 1h gap exactly/);
});

test("ER4 carries the longest gap (the closest miss)", () => {
  const events = [e("a", "09:00", "13:45"), e("b", "15:00", "17:00"), e("c", "17:00", "18:00")];
  assert.throws(() => findBestSlots(task(90), W, events), (err) =>
    isCode("ER4")(err) && err.data.longestGap.start === m("13:45") && err.data.longestGap.end === m("15:00"));
});

test("ER4 when every fit would leave a leftover under 15 minutes", () => {
  // only gap is 70 min for a 60 min task: 10 min left over whichever edge
  const events = [e("a", "09:00", "12:00"), e("b", "13:10", "18:00")];
  assert.throws(() => findBestSlots(task(60), W, events), isCode("ER4"));
  assert.doesNotThrow(() => findBestSlots(task(55), W, events)); // 15 min left over is fine
});

test("candidates sit at gap edges and results are ranked, at most 3", () => {
  const recs = findBestSlots(task(60), W, [e("a", "11:00", "12:00"), e("b", "15:00", "16:00")]);
  assert.ok(recs.length <= 3);
  assert.deepEqual(recs.map((r) => r.rank), recs.map((_, i) => i + 1));
  for (let i = 1; i < recs.length; i++) assert.ok(recs[i - 1].scoreTotal >= recs[i].scoreTotal);
  for (const r of recs) {
    const g = r.containingGap;
    assert.ok(r.slot.start === g.start || r.slot.end === g.end);
  }
});

test("empty day: earliest slot wins and says so", () => {
  const [best] = findBestSlots(task(60), W, []);
  assert.deepEqual(best.slot, { start: m("09:00"), end: m("10:00") });
  assert.match(best.reason, /^Earliest option/);
});

test("deadline urgency fades to 0 over 24 hours", () => {
  const t = task(60, { deadline: { day: DAY, minute: m("10:00") } });
  const gap = { start: 0, end: 1440 };
  const at = (s) => scoreSlot({ start: m(s), end: m(s) + 60 }, gap, t, W).breakdown.deadlineUrgency;
  assert.equal(at("09:00"), 1); // ends 10:00, on time
  assert.equal(at("10:00"), 1 - 60 / 1440); // 1h late
  const dayAfter = scoreSlot({ start: m("10:00"), end: m("11:00") }, gap,
    task(60, { deadline: { day: "2026-10-14", minute: m("11:00") } }), W).breakdown.deadlineUrgency;
  assert.equal(dayAfter, 0); // exactly 24h late
});

test("slots after the deadline rank below slots before it", () => {
  const t = task(60, { deadline: { day: DAY, minute: m("12:00") } });
  const recs = findBestSlots(t, W, [e("a", "09:00", "11:00"), e("b", "11:00", "16:00")]);
  assert.ok(recs.every((r) => r.slot.start >= m("16:00")));
  assert.match(recs[0].reason, /after the deadline/);
  assert.ok(recs[0].scoreBreakdown.deadlineUrgency < 1);
});

test("user breaks: slots overlapping lunch lose the working-hours point, break edges become candidates", () => {
  const lunch = [{ start: m("13:00"), end: m("14:00") }];
  const recs = findBestSlots(task(60), { day: DAY, start: m("12:30"), end: m("16:00") }, [], { breaks: lunch });
  assert.ok(recs.some((r) => r.slot.start === m("14:00") && /after your break/.test(r.reason)));
  for (const r of recs) {
    const hitsLunch = r.slot.start < m("14:00") && m("13:00") < r.slot.end;
    assert.equal(r.scoreBreakdown.workingHours, hitsLunch ? 0 : 1);
  }
  assert.equal(recs[0].scoreBreakdown.workingHours, 1);
});

test("slots outside working hours score 0 on that component", () => {
  const recs = findBestSlots(task(60), { day: DAY, start: m("17:30"), end: m("20:00") }, []);
  assert.ok(recs.some((r) => r.scoreBreakdown.workingHours === 0 && /outside working hours/.test(r.reason)));
});

test("high priority weights earliness more than low priority", () => {
  const slot = { start: m("09:00"), end: m("10:00") };
  const gap = { start: m("09:00"), end: m("18:00") };
  const high = scoreSlot(slot, gap, task(60, { priority: "high" }), W).total;
  const low = scoreSlot(slot, gap, task(60, { priority: "low" }), W).total;
  assert.ok(high > low);
});

test("all scores are within [0, 1]", () => {
  const recs = findBestSlots(task(45, { deadline: { day: DAY, minute: m("09:30") } }), W, [e("a", "10:00", "11:00")]);
  for (const r of recs) {
    assert.ok(r.scoreTotal >= 0 && r.scoreTotal <= 1);
    for (const v of Object.values(r.scoreBreakdown)) assert.ok(v >= 0 && v <= 1);
  }
});

test("invariant on random days: every slot is free, inside a gap, inside the window and fits", () => {
  const rand = rng(31);
  for (let round = 0; round < 300; round++) {
    const events = Array.from({ length: Math.floor(rand() * 12) }, (_, i) => {
      const s = 480 + Math.floor(rand() * 600);
      return { id: "e" + i, title: "E" + i, start: s, end: Math.min(1440, s + 15 + Math.floor(rand() * 120)) };
    });
    const busy = new Array(1440).fill(false);
    for (const x of events) for (let t = x.start; t < x.end; t++) busy[t] = true;
    const d = 15 + Math.floor(rand() * 120);
    let recs;
    try {
      recs = findBestSlots(task(d), W, events);
    } catch (err) {
      assert.ok(isCode("ER4")(err), "only ER4 is expected here");
      continue;
    }
    for (const r of recs) {
      assert.equal(r.slot.end - r.slot.start, d);
      assert.ok(r.slot.start >= W.start && r.slot.end <= W.end);
      assert.ok(r.slot.start >= r.containingGap.start && r.slot.end <= r.containingGap.end);
      for (let t = r.slot.start; t < r.slot.end; t++) assert.equal(busy[t], false);
      assert.ok(r.slackBefore === 0 || r.slackBefore >= 15);
      assert.ok(r.slackAfter === 0 || r.slackAfter >= 15);
    }
  }
});

test("findAlternativesFor ignores the event's own time", () => {
  const meeting = { ...e("ta", "11:00", "12:00", "Meeting with TA"), priority: "medium" };
  const events = [e("lecture", "10:00", "11:30", "DPCS lecture"), meeting];
  const recs = findAlternativesFor(meeting, events, W);
  assert.ok(recs.length > 0);
  for (const r of recs) {
    assert.equal(r.slot.end - r.slot.start, 60);
    assert.ok(r.slot.end <= m("10:00") || r.slot.start >= m("11:30"));
  }
});

test("findBestSlotsInStore uses and fills the per-day cache", () => {
  const s = new EventStore();
  s.addEvent(ev({ id: "x", day: DAY, start: m("10:00"), end: m("11:00") }));
  assert.equal(s.getBusy(DAY), undefined);
  const first = findBestSlotsInStore(s, task(60), W);
  assert.deepEqual(s.getBusy(DAY), [{ start: m("10:00"), end: m("11:00") }]);
  const second = findBestSlotsInStore(s, task(60), W);
  assert.deepEqual(second, first);
  s.addEvent(ev({ id: "y", day: DAY, start: m("09:00"), end: m("10:00") })); // invalidates
  assert.equal(s.getBusy(DAY), undefined);
  const third = findBestSlotsInStore(s, task(60), W);
  assert.ok(third.every((r) => r.slot.start >= m("11:00")));
});

test("config is the only place weights live", () => {
  assert.deepEqual(Object.keys(DEFAULT_CONFIG.weights), ["earliness", "fitTightness", "deadlineUrgency", "workingHours"]);
});
