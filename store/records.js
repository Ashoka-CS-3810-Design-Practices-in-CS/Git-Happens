/**
 * store/records.js
 *
 * Event and Task records (Assignment 2, section 4.2).
 *
 *   Event = { id, title, day, start, end, description, priority, category, sourceTaskId }
 *   Task  = { id, name, duration, priority, window, deadline, status, scheduledEventId }
 *
 * - Times are integer minutes from midnight (0..1440). Clock strings like
 *   "09:30" only exist in the presentation layer.
 * - day is a "YYYY-MM-DD" string. Events never cross midnight.
 * - Records are frozen. To change one, build a new one with withChanges().
 *   That keeps the store's sorted day lists safe from outside edits.
 *
 * The checks here are safety guards that throw RecordError. The friendly,
 * user-facing messages (ER1 etc.) belong to application/validation.js, which
 * runs BEFORE anything reaches the store.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./interval.js"));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const { Interval } = deps;

  const MINUTES_PER_DAY = 1440;
  const PRIORITIES = Object.freeze(["low", "medium", "high"]);
  const CATEGORIES = Object.freeze(["meeting", "class", "appointment", "assignment", "personal task"]);
  const DEFAULT_CATEGORY = "personal task";
  const TASK_STATUS = Object.freeze({ UNPLACED: "unplaced", SCHEDULED: "scheduled" });

  /** Thrown when a record breaks an invariant. `field` names the bad field. */
  class RecordError extends Error {
    constructor(field, message) {
      super(message);
      this.name = "RecordError";
      this.field = field;
    }
  }

  // ---------------------------------------------------------------- helpers

  const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

  /** True for a real calendar date written as "YYYY-MM-DD" (rejects 2026-02-30). */
  function isDayKey(day) {
    if (typeof day !== "string") return false;
    const m = DAY_KEY.exec(day);
    if (!m) return false;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const date = new Date(Date.UTC(y, mo - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  }

  let idCounter = 0;

  /** Unique id such as "ev_1a2b..." or "task_...". */
  function newId(prefix) {
    const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (c && typeof c.randomUUID === "function") return `${prefix}_${c.randomUUID()}`;
    idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}`;
  }

  function checkDay(field, day) {
    if (!isDayKey(day)) throw new RecordError(field, `${field} must be a real date "YYYY-MM-DD", got ${day}`);
  }

  /** start/end must be integers with 0 <= start < end <= 1440. */
  function checkTimes(field, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new RecordError(field, `${field} times must be integer minutes, got ${start}-${end}`);
    }
    if (start < 0 || end > MINUTES_PER_DAY) {
      throw new RecordError(field, `${field} must lie within 0..${MINUTES_PER_DAY}, got ${start}-${end}`);
    }
    if (start >= end) {
      throw new RecordError(field, `${field} needs start < end, got ${start}-${end}`);
    }
  }

  function checkPriority(priority) {
    if (!PRIORITIES.includes(priority)) {
      throw new RecordError("priority", `priority must be one of ${PRIORITIES.join(", ")}, got ${priority}`);
    }
  }

  function checkId(id) {
    if (typeof id !== "string" || id.length === 0) throw new RecordError("id", "id must be a non-empty string");
  }

  // ----------------------------------------------------------------- events

  /**
   * Build a frozen, checked Event. Missing id gets a new one.
   * A missing or empty category defaults to "personal task" (FR2).
   */
  function createEvent(fields) {
    const ev = {
      id: fields.id || newId("ev"),
      title: String(fields.title ?? "").trim(),
      day: fields.day,
      start: fields.start,
      end: fields.end,
      description: String(fields.description ?? ""),
      priority: fields.priority,
      category: fields.category || DEFAULT_CATEGORY,
      sourceTaskId: fields.sourceTaskId ?? null,
    };

    checkId(ev.id);
    if (ev.title.length === 0) throw new RecordError("title", "title is required");
    checkDay("day", ev.day);
    checkTimes("time", ev.start, ev.end);
    checkPriority(ev.priority);
    if (!CATEGORIES.includes(ev.category)) {
      throw new RecordError("category", `category must be one of ${CATEGORIES.join(", ")}, got ${ev.category}`);
    }
    if (ev.sourceTaskId !== null && typeof ev.sourceTaskId !== "string") {
      throw new RecordError("sourceTaskId", "sourceTaskId must be a string or null");
    }
    return Object.freeze(ev);
  }

  /** New Event with some fields changed. The id cannot change. */
  function withChanges(ev, changes) {
    if ("id" in changes && changes.id !== ev.id) throw new RecordError("id", "an event's id cannot be changed");
    return createEvent({ ...ev, ...changes, id: ev.id });
  }

  /** Project an Event to an Interval (what Conflict and Scheduling work on). */
  function eventInterval(ev) {
    return new Interval(ev.start, ev.end);
  }

  // ------------------------------------------------------------------ tasks

  function freezeWindow(w) {
    if (w == null) return null;
    checkDay("window.day", w.day);
    checkTimes("window", w.start, w.end);
    return Object.freeze({ day: w.day, start: w.start, end: w.end });
  }

  function freezeDeadline(d) {
    if (d == null) return null;
    checkDay("deadline.day", d.day);
    if (!Number.isInteger(d.minute) || d.minute < 0 || d.minute > MINUTES_PER_DAY) {
      throw new RecordError("deadline", `deadline.minute must be an integer in 0..${MINUTES_PER_DAY}`);
    }
    return Object.freeze({ day: d.day, minute: d.minute });
  }

  /**
   * Build a frozen, checked Task.
   *   window:   { day, start, end } or null (set when the user runs Find a time)
   *   deadline: { day, minute } or null
   *   status "scheduled" <=> scheduledEventId is set
   */
  function createTask(fields) {
    const task = {
      id: fields.id || newId("task"),
      name: String(fields.name ?? "").trim(),
      duration: fields.duration,
      priority: fields.priority,
      window: freezeWindow(fields.window),
      deadline: freezeDeadline(fields.deadline),
      status: fields.status || TASK_STATUS.UNPLACED,
      scheduledEventId: fields.scheduledEventId ?? null,
    };

    checkId(task.id);
    if (task.name.length === 0) throw new RecordError("name", "task name is required");
    if (!Number.isInteger(task.duration) || task.duration <= 0 || task.duration > MINUTES_PER_DAY) {
      throw new RecordError("duration", `duration must be an integer in 1..${MINUTES_PER_DAY} minutes`);
    }
    checkPriority(task.priority);
    if (!Object.values(TASK_STATUS).includes(task.status)) {
      throw new RecordError("status", `status must be "unplaced" or "scheduled", got ${task.status}`);
    }
    const scheduled = task.status === TASK_STATUS.SCHEDULED;
    if (scheduled !== (task.scheduledEventId !== null)) {
      throw new RecordError("status", "a task is scheduled exactly when it has a scheduledEventId");
    }
    return Object.freeze(task);
  }

  /** New Task with some fields changed. The id cannot change. */
  function withTaskChanges(task, changes) {
    if ("id" in changes && changes.id !== task.id) throw new RecordError("id", "a task's id cannot be changed");
    return createTask({ ...task, ...changes, id: task.id });
  }

  /**
   * Turn an accepted slot into an Event (Assignment 1, toEvent).
   * @param {object} task
   * @param {string} day
   * @param {{start:number,end:number}} interval
   */
  function toEvent(task, day, interval) {
    return createEvent({
      title: task.name,
      day,
      start: interval.start,
      end: interval.end,
      description: "",
      priority: task.priority,
      category: "personal task",
      sourceTaskId: task.id,
    });
  }

  return {
    MINUTES_PER_DAY,
    PRIORITIES,
    CATEGORIES,
    DEFAULT_CATEGORY,
    TASK_STATUS,
    RecordError,
    isDayKey,
    newId,
    createEvent,
    withChanges,
    eventInterval,
    createTask,
    withTaskChanges,
    toEvent,
  };
});
