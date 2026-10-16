/**
 * scheduling/scoring.js
 *
 * Ranking criteria (Assignment 1 section 4.5, Assignment 3 question 6).
 * Everything that might be tuned lives in DEFAULT_CONFIG, so changing the
 * ranking touches only this file.
 *
 * Four components, each in [0, 1], combined by weighted average:
 *   earliness        1 - (slot.start - window.start) / window length
 *   fitTightness     duration / length of the gap the slot sits in
 *   deadlineUrgency  1 if the slot ends by the deadline (or no deadline);
 *                    after it, fades linearly to 0 over 24 hours
 *   workingHours     1 if inside working hours and clear of the user's
 *                    breaks, else 0
 *
 * Priority (FR5): high priority cares more about getting it done early,
 * so the earliness weight is multiplied by 1.5 (high), 1 (medium) or
 * 0.5 (low) before averaging.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory());
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_CONFIG = Object.freeze({
    weights: Object.freeze({ earliness: 0.25, fitTightness: 0.25, deadlineUrgency: 0.3, workingHours: 0.2 }),
    priorityEarlinessFactor: Object.freeze({ high: 1.5, medium: 1, low: 0.5 }),
    workingHours: Object.freeze({ start: 9 * 60, end: 18 * 60 }), // 09:00-18:00
    deadlineFadeMinutes: 24 * 60,
    minUseful: 15, // leftover gaps shorter than this are not allowed
    limit: 3, // how many suggestions to return
  });

  /** "2026-10-14" -> whole days since 1970, for comparing dates. */
  function dayNumber(day) {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  }

  /** Minutes the slot ends after the deadline (0 if on time or no deadline). */
  function minutesLate(day, slotEnd, deadline) {
    if (!deadline) return 0;
    const diff = (dayNumber(day) - dayNumber(deadline.day)) * 1440 + (slotEnd - deadline.minute);
    return Math.max(0, diff);
  }

  function overlapsAny(slot, breaks) {
    return breaks.some((b) => b.start < slot.end && slot.start < b.end);
  }

  /**
   * Score one candidate.
   * @param {{start,end}} slot
   * @param {{start,end}} gap      the free gap containing the slot
   * @param {object} task          { duration, priority, deadline }
   * @param {{day,start,end}} window
   * @param {Array<{start,end}>} breaks
   * @param {object} config        defaults to DEFAULT_CONFIG
   * @returns {{ total:number, breakdown:object, late:number }}
   */
  function scoreSlot(slot, gap, task, window, breaks = [], config = DEFAULT_CONFIG) {
    const late = minutesLate(window.day, slot.end, task.deadline);
    const wh = config.workingHours;
    const breakdown = {
      earliness: 1 - (slot.start - window.start) / (window.end - window.start),
      fitTightness: task.duration / (gap.end - gap.start),
      deadlineUrgency: late === 0 ? 1 : Math.max(0, 1 - late / config.deadlineFadeMinutes),
      workingHours: slot.start >= wh.start && slot.end <= wh.end && !overlapsAny(slot, breaks) ? 1 : 0,
    };

    const w = { ...config.weights };
    w.earliness *= config.priorityEarlinessFactor[task.priority] ?? 1;

    let sum = 0;
    let weightSum = 0;
    for (const k of Object.keys(breakdown)) {
      sum += w[k] * breakdown[k];
      weightSum += w[k];
    }
    return { total: weightSum > 0 ? sum / weightSum : 0, breakdown, late };
  }

  return { DEFAULT_CONFIG, scoreSlot, minutesLate, overlapsAny };
});
