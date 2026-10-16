/**
 * scheduling/findBestSlots.js
 *
 * Best available time finder (Assignment 2, Algorithm 4).
 *
 *   1. ER3 if the window is shorter than the task (checked before any
 *      events are read).
 *   2. Clip events to the window, merge them into busy blocks.
 *   3. Free gaps = window minus busy.
 *   4. Keep gaps long enough for the task, else ER4 (with the longest gap,
 *      so the UI can show the closest miss).
 *   5. Candidates are anchored to gap edges (and to the edges of the user's
 *      breaks), never every possible minute.
 *   6. Drop candidates that leave a leftover shorter than 15 minutes.
 *   7. Score, rank, return the top 3 with a plain-language reason.
 *
 * Time O(n_W log n_W + m log m), space O(n_W + m).
 * Pure: reads only what it is given and returns plain data.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(Object.assign({}, require("./intervals.js"), require("./scoring.js")));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const { mergeIntervals, complement, clipToWindow, DEFAULT_CONFIG, scoreSlot, overlapsAny } = deps;

  /** code: ER3 | ER4. data carries the numbers the UI needs for its fixes. */
  class SchedulingError extends Error {
    constructor(code, message, data) {
      super(message);
      this.name = "SchedulingError";
      this.code = code;
      this.data = data;
    }
  }

  // ------------------------------------------------------------- formatting

  function clock(min) {
    const h = String(Math.floor(min / 60)).padStart(2, "0");
    const m = String(min % 60).padStart(2, "0");
    return `${h}:${m}`;
  }

  /** 45 -> "45 min", 60 -> "1h", 90 -> "1h 30m" */
  function duration(min) {
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  // ------------------------------------------------------------- checks

  function checkWindow(window) {
    if (!window || typeof window.day !== "string" || !Number.isInteger(window.start) ||
        !Number.isInteger(window.end) || window.start < 0 || window.end > 1440 || window.start >= window.end) {
      throw new TypeError("window must be { day, start, end } with 0 <= start < end <= 1440");
    }
  }

  function checkBreaks(breaks) {
    for (const b of breaks) {
      if (!b || !Number.isInteger(b.start) || !Number.isInteger(b.end) || b.start >= b.end) {
        throw new TypeError("each break must be { start, end } with start < end");
      }
    }
  }

  /** ER3: impossible under any calendar. Never reads events. */
  function checkRequest(task, window) {
    checkWindow(window);
    if (!Number.isInteger(task.duration) || task.duration <= 0) {
      throw new SchedulingError("ER3", "The task needs a duration of at least 1 minute.",
        { windowMinutes: window.end - window.start, durationMinutes: task.duration });
    }
    const len = window.end - window.start;
    if (len < task.duration) {
      throw new SchedulingError("ER3",
        `The window ${clock(window.start)} – ${clock(window.end)} is ${duration(len)}, but the task needs ${duration(task.duration)}.`,
        { windowMinutes: len, durationMinutes: task.duration });
    }
  }

  // ------------------------------------------------------------- candidates

  /** Slot starts anchored to the gap's edges and to break edges inside it. */
  function candidateStarts(gap, d, breaks) {
    const lo = gap.start;
    const hi = gap.end - d;
    const starts = new Set([lo, hi]);
    for (const b of breaks) {
      if (b.end >= lo && b.end <= hi) starts.add(b.end); // right after a break
      if (b.start - d >= lo && b.start - d <= hi) starts.add(b.start - d); // right before a break
    }
    return Array.from(starts).sort((a, b) => a - b);
  }

  /** Fragmentation filter: leftover on either side must be 0 or >= minUseful. */
  function fragments(slot, gap, minUseful) {
    const before = slot.start - gap.start;
    const after = gap.end - slot.end;
    return (before > 0 && before < minUseful) || (after > 0 && after < minUseful);
  }

  function boundingEvents(gap, events) {
    let before = null;
    let after = null;
    for (const e of events) {
      if (e.end === gap.start && (before === null || e.start > before.start)) before = e;
      if (e.start === gap.end && (after === null || e.end < after.end)) after = e;
    }
    return { before, after };
  }

  // ------------------------------------------------------------- reasons

  function buildReason(c, isEarliest, task, breaks) {
    const parts = [];
    if (isEarliest) parts.push("earliest option");

    if (c.slot.start === c.gap.start && c.before) parts.push(`starts as ${c.before.title} ends`);
    else if (c.slot.end === c.gap.end && c.after) parts.push(`ends as ${c.after.title} starts`);
    else if (breaks.some((b) => b.end === c.slot.start)) parts.push("starts right after your break");
    else if (breaks.some((b) => b.start === c.slot.end)) parts.push("ends right before your break");

    const slack = c.slackBefore + c.slackAfter;
    parts.push(slack === 0 ? `fills the ${duration(c.gap.end - c.gap.start)} gap exactly` : `${duration(slack)} stays free`);

    if (task.deadline) {
      parts.push(c.late === 0 ? "done before the deadline" : `${duration(c.late)} after the deadline`);
    }
    if (overlapsAny(c.slot, breaks)) parts.push("overlaps your break");
    else if (c.breakdown.workingHours === 0) parts.push("outside working hours");

    const text = parts.join(", ");
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  // ------------------------------------------------------------- main

  /**
   * Rank the best places for a flexible task.
   *
   * @param {object} task     { duration, priority, deadline? }  (a Task record works)
   * @param {object} window   { day, start, end }  single day, integer minutes
   * @param {Array}  events   events in the window, e.g. store.eventsIn(window)
   * @param {object} [options]
   *   breaks  [{ start, end }]  the user's breaks, e.g. lunch 13:00-14:00
   *   config  scoring config (defaults to DEFAULT_CONFIG)
   *   busy    precomputed merged busy blocks for the window (from the cache)
   * @returns {Array<Recommendation>} best first, at most config.limit
   * @throws {SchedulingError} ER3 or ER4
   */
  function findBestSlots(task, window, events, options = {}) {
    checkRequest(task, window);
    const breaks = options.breaks || [];
    checkBreaks(breaks);
    const config = options.config || DEFAULT_CONFIG;
    const d = task.duration;

    const busy = options.busy || mergeIntervals(clipToWindow(events, window));
    const free = complement(busy, window);

    let longestGap = null;
    for (const g of free) {
      if (longestGap === null || g.end - g.start > longestGap.end - longestGap.start) longestGap = g;
    }
    const noSlot = () => new SchedulingError("ER4",
      `No free ${duration(d)} on ${window.day} between ${clock(window.start)} and ${clock(window.end)}.`,
      { longestGap, durationMinutes: d, window: { ...window } });

    const fits = free.filter((g) => g.end - g.start >= d);
    if (fits.length === 0) throw noSlot();

    const candidates = [];
    for (const gap of fits) {
      const { before, after } = boundingEvents(gap, events);
      for (const start of candidateStarts(gap, d, breaks)) {
        const slot = { start, end: start + d };
        if (fragments(slot, gap, config.minUseful)) continue;
        const scored = scoreSlot(slot, gap, task, window, breaks, config);
        candidates.push({
          slot, gap, before, after,
          slackBefore: slot.start - gap.start,
          slackAfter: gap.end - slot.end,
          raw: scored.total,
          breakdown: scored.breakdown,
          late: scored.late,
        });
      }
    }
    if (candidates.length === 0) throw noSlot();

    candidates.sort((a, b) => b.raw - a.raw || a.slot.start - b.slot.start);
    const earliestStart = Math.min(...candidates.map((c) => c.slot.start));

    return candidates.slice(0, config.limit).map((c, i) => Object.freeze({
      day: window.day,
      slot: Object.freeze({ ...c.slot }),
      containingGap: Object.freeze({ ...c.gap }),
      boundedBefore: c.before ? c.before.id : null,
      boundedAfter: c.after ? c.after.id : null,
      slackBefore: c.slackBefore,
      slackAfter: c.slackAfter,
      scoreTotal: Math.round(c.raw * 100) / 100,
      scoreBreakdown: Object.freeze({
        earliness: round2(c.breakdown.earliness),
        fitTightness: round2(c.breakdown.fitTightness),
        deadlineUrgency: round2(c.breakdown.deadlineUrgency),
        workingHours: c.breakdown.workingHours,
      }),
      reason: buildReason(c, c.slot.start === earliestStart, task, breaks),
      rank: i + 1,
    }));
  }

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * "Find another time" for an event that clashes: same length, same day,
   * with the event itself not counted as busy.
   */
  function findAlternativesFor(event, events, window, options = {}) {
    const task = { duration: event.end - event.start, priority: event.priority, deadline: null };
    return findBestSlots(task, window, events.filter((e) => e.id !== event.id), options);
  }

  /**
   * findBestSlots using the store, with the per-day busy cache.
   * ER3 is checked before the store is touched.
   */
  function findBestSlotsInStore(store, task, window, options = {}) {
    checkRequest(task, window);
    let dayBusy = store.getBusy(window.day);
    if (dayBusy === undefined) {
      dayBusy = mergeIntervals(store.eventsOn(window.day));
      store.putBusy(window.day, dayBusy);
    }
    const busy = mergeIntervals(clipToWindow(dayBusy, window)); // still disjoint, now inside the window
    return findBestSlots(task, window, store.eventsIn(window), { ...options, busy });
  }

  return { findBestSlots, findAlternativesFor, findBestSlotsInStore, SchedulingError, formatClock: clock, formatDuration: duration, fragments };
});
