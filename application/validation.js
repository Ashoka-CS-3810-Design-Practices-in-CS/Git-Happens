/**
 * application/validation.js
 *
 * Checks what the user typed BEFORE anything reaches the store or the
 * algorithms (Assignment 1 section 3.1.1, FR9, ER1). Returns friendly,
 * per-field messages the form can show under the right input.
 *
 * Every function returns either
 *   { ok: true,  value }                         ready for the store
 *   { ok: false, errors: [{ code, field, message }] }
 * and never throws for bad input.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../store/records.js"));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const { isDayKey, PRIORITIES, CATEGORIES, DEFAULT_CATEGORY } = deps;

  const MIN_EVENT_MINUTES = 15;
  const SNAP_MINUTES = 15;

  // ------------------------------------------------------------ helpers

  /** "09:30" -> 570. "24:00" -> 1440. Anything else -> null. */
  function parseClock(text) {
    if (typeof text === "number" && Number.isInteger(text) && text >= 0 && text <= 1440) return text;
    if (typeof text !== "string") return null;
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(text);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
    return h * 60 + min;
  }

  /** 570 -> "09:30" */
  function formatClock(min) {
    return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
  }

  function err(field, message) {
    return { code: "ER1", field, message };
  }

  function result(errors, value) {
    return errors.length ? { ok: false, errors } : { ok: true, value };
  }

  /** Checks a start/end pair; pushes errors and returns { start, end } or null. */
  function checkTimes(startText, endText, errors) {
    const start = parseClock(startText);
    const end = parseClock(endText);
    if (start === null || start >= 1440) {
      errors.push(err("start", "Invalid time period: enter a real start time, like 09:30."));
    }
    if (end === null || end === 0) {
      errors.push(err("end", "Invalid time period: enter a real end time, like 10:30."));
    }
    if (start !== null && start < 1440 && end !== null && end !== 0 && end <= start) {
      errors.push(err("end", `End time is before the start. Set it after ${formatClock(start)}, on the same day.`));
    }
    return errors.length ? null : { start, end };
  }

  // ------------------------------------------------------------ forms

  /**
   * Event editor form:
   *   { title, date: "YYYY-MM-DD", start: "HH:MM", end: "HH:MM",
   *     description?, priority, category? }
   * value: fields ready for store.addEvent / updateEvent.
   */
  function validateEventForm(form = {}) {
    const errors = [];
    const title = String(form.title ?? "").trim();
    if (!title) errors.push(err("title", "Add a title."));
    if (!isDayKey(form.date)) errors.push(err("date", "Pick a real date."));
    const times = checkTimes(form.start, form.end, errors);
    if (!PRIORITIES.includes(form.priority)) errors.push(err("priority", "Choose Low, Medium or High."));
    const category = form.category || DEFAULT_CATEGORY;
    if (!CATEGORIES.includes(category)) errors.push(err("category", "Choose one of the categories."));

    return result(errors, errors.length ? undefined : {
      title,
      day: form.date,
      start: times.start,
      end: times.end,
      description: String(form.description ?? ""),
      priority: form.priority,
      category,
    });
  }

  /**
   * New task form:
   *   { name, duration (minutes, number or "90"), priority,
   *     deadlineDate?, deadlineTime? }   (deadline: both or neither)
   */
  function validateTaskForm(form = {}) {
    const errors = [];
    const name = String(form.name ?? "").trim();
    if (!name) errors.push(err("name", "Add a name for the task."));

    const duration = Number(form.duration);
    if (!Number.isInteger(duration) || duration < 1 || duration > 1440) {
      errors.push(err("duration", "Duration must be a whole number of minutes, up to 24 hours."));
    }
    if (!PRIORITIES.includes(form.priority)) errors.push(err("priority", "Choose Low, Medium or High."));

    let deadline = null;
    const hasDate = !!form.deadlineDate;
    const hasTime = !!form.deadlineTime;
    if (hasDate || hasTime) {
      const minute = parseClock(form.deadlineTime);
      if (!hasDate || !isDayKey(form.deadlineDate)) errors.push(err("deadlineDate", "Pick a real deadline date, or clear the deadline."));
      else if (minute === null) errors.push(err("deadlineTime", "Enter a real deadline time, like 17:00."));
      else deadline = { day: form.deadlineDate, minute };
    }

    return result(errors, errors.length ? undefined : { name, duration, priority: form.priority, deadline });
  }

  /**
   * Find-a-time window: { date, start?, end? }. Missing times default to
   * working hours. value: { day, start, end } in minutes.
   */
  function validateWindowForm(form = {}, workingHours = { start: 540, end: 1080 }) {
    const errors = [];
    if (!isDayKey(form.date)) errors.push(err("date", "Pick a real day for the window."));
    const startText = form.start ?? formatClock(workingHours.start);
    const endText = form.end ?? formatClock(workingHours.end);
    const times = checkTimes(startText, endText, errors);
    return result(errors, errors.length ? undefined : { day: form.date, start: times.start, end: times.end });
  }

  /** Breaks typed by the user: [{ start: "13:00", end: "14:00" }] -> minutes. */
  function validateBreaks(list = []) {
    const errors = [];
    const value = [];
    for (const b of list) {
      const s = parseClock(b && b.start);
      const e = parseClock(b && b.end);
      if (s === null || e === null || e <= s) {
        errors.push(err("breaks", "Each break needs a start and an end, with the end after the start."));
      } else value.push({ start: s, end: e });
    }
    return result(errors, value);
  }

  /**
   * Direct manipulation never shows an error (Assignment 1, Flow B step 2):
   * snap to 15 minutes, keep inside the day, and stop at 15 minutes long.
   * clamped is true when the 15-minute minimum kicked in (show the hint).
   */
  function clampDrag({ start, end }) {
    const rawTooShort = end - start < MIN_EVENT_MINUTES;
    let s = Math.round(start / SNAP_MINUTES) * SNAP_MINUTES;
    let e = Math.round(end / SNAP_MINUTES) * SNAP_MINUTES;
    s = Math.min(Math.max(s, 0), 1440 - MIN_EVENT_MINUTES);
    e = Math.min(Math.max(e, 0), 1440);
    let clamped = rawTooShort;
    if (e - s < MIN_EVENT_MINUTES) {
      clamped = true;
      e = s + MIN_EVENT_MINUTES;
    }
    return { start: s, end: e, clamped };
  }

  return {
    MIN_EVENT_MINUTES,
    parseClock,
    validateEventForm,
    validateTaskForm,
    validateWindowForm,
    validateBreaks,
    clampDrag,
  };
});
