/**
 * application/app.js
 *
 * The Application layer. The UI calls only this.
 *
 *   - Validates input before anything is changed.
 *   - Runs Flows A-D which are create, edit/move/resize, schedule a task, delete.
 *   - After every change runs one pipeline:
 *       affected days -> invalidate caches -> recheck conflicts ->
 *       refresh open suggestions -> schedule a save -> render(days)
 *   - Keeps the undo history.
 *   - Turns ER3 / ER4 from Scheduling into plain error objects.
 *
 * Every action returns a plain result object
 *   success: { ok: true, message, ... }
 *   failure: { ok: false, errors: [{ code, field?, message }] }   (ER1, NOT_FOUND)
 *        or: { ok: false, error: { code, message, data } }        (ER3, ER4)
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(Object.assign({},
      require("../store/records.js"),
      require("../conflict/detectConflicts.js"),
      require("../scheduling/findBestSlots.js"),
      require("./validation.js"),
      require("./history.js")));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const {
    toEvent, TASK_STATUS,
    detectConflicts, conflictsFor, conflictsInvolving,
    findBestSlotsInStore, findAlternativesFor, SchedulingError, formatClock,
    validateEventForm, validateTaskForm, validateWindowForm, validateBreaks, clampDrag,
    UndoHistory,
  } = deps;

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  /** "2026-10-15" -> "Thu 15" */
  function dayLabel(day) {
    const [y, m, d] = day.split("-").map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return `${WEEKDAYS[date.getUTCDay()]} ${d}`;
  }

  function notFound(what) {
    return { ok: false, errors: [{ code: "NOT_FOUND", message: `That ${what} no longer exists.` }] };
  }

  function schedulingFailure(e) {
    if (e instanceof SchedulingError) return { ok: false, error: { code: e.code, message: e.message, data: e.data } };
    throw e;
  }

  /** Only the editable fields of an event (used to restore it in case of undo). */
  function editableFields(ev) {
    return { title: ev.title, day: ev.day, start: ev.start, end: ev.end,
      description: ev.description, priority: ev.priority, category: ev.category };
  }

  class App {
    #store;
    #persistence;
    #render;
    #history;
    #workingHours;
    #conflicts = new Map(); // day -> Conflict[]
    #search = null; // the open "Find a time" search

    /**
     * @param {EventStore} store is where all the events are kept while the page is open.
     * @param {object} [options]
     *   persistence   a Persistence (optional; without it nothing is saved after a refresh)
     *   render        (days: string[], info: object) => void, called after every change so the screen can reflect the new changes
     *   workingHours  { start, end } in minutes, default 09:00-18:00
     */
    constructor(store, options = {}) {
      this.#store = store;
      this.#persistence = options.persistence || null;
      this.#render = options.render || (() => {});
      this.#history = new UndoHistory(options.historyLimit || 50);
      this.#workingHours = options.workingHours || { start: 540, end: 1080 };
    }

    /** Read-only access for the UI */
    get store() {
      return this.#store;
    }

    // ============================================================ start-up

    /**
     * Load saved data and compute conflicts for every day.
     * Returns the load result ({ status, warning? }) so the UI can show warnings.
     */
    start() {
      const loaded = this.#persistence ? this.#persistence.load() : { status: "empty" };
      this.#conflicts.clear();
      this.#history.clear();
      const days = this.#store.days();
      for (const d of days) this.#recheckDay(d);
      this.#render(days, { type: "start", loaded });
      return loaded;
    }

    // ============================================================ reads

    /** All conflicts on a day. */
    conflictsOn(day) {
      return (this.#conflicts.get(day) || []).slice();
    }

    /** Conflicts involving one event. */
    conflictsForEvent(id) {
      const ev = this.#store.getEvent(id);
      return ev ? conflictsInvolving(this.conflictsOn(ev.day), id) : [];
    }

    /** Days that currently have at least one conflict. */
    daysWithConflicts() {
      return Array.from(this.#conflicts.keys()).sort();
    }

    get canUndo() {
      return this.#history.canUndo;
    }

    get undoLabel() {
      return this.#history.nextLabel;
    }

    /** The open Find-a-time search: { taskId, window, breaks, result } or null. */
    get openSearch() {
      return this.#search;
    }

    // ============================================================ Flow A: create

    /**
     * Create an event from the editor form.
     * Returns { ok, event, conflicts, alternatives, message } or ER1 errors.
     * Conflicts do not block saving (ER2): the event is kept and flagged.
     */
    createEvent(form) {
      const v = validateEventForm(form);
      if (!v.ok) return v;
      const ev = this.#store.addEvent(v.value);
      this.#history.push(`Add ${ev.title}`, () => {
        this.#store.removeEvent(ev.id);
        return [ev.day];
      });
      this.#recompute([ev.day], { type: "create", eventId: ev.id });
      return this.#eventResult(ev, "Event added");
    }

    // edit / move / resize

    /** Edit an event from the editor form. Bad input -> ER1, nothing changes in the application. */
    updateEvent(id, form) {
      if (!this.#store.hasEvent(id)) return notFound("event");
      const v = validateEventForm(form);
      if (!v.ok) return v;
      return this.#change(id, v.value, "update", () => "Event updated");
    }

    /**
     * Drag to move or resize: { day?, start, end } in minutes.
     * snaps to 15 minutes and stops at the 15-minute minimum.
     * Result has clamped: true when the "Minimum 15 min" hint should show.
     */
    moveEvent(id, proposed) {
      const ev = this.#store.getEvent(id);
      if (!ev) return notFound("event");
      const iv = clampDrag(proposed);
      const day = proposed.day || ev.day;
      const res = this.#change(id, { day, start: iv.start, end: iv.end }, "move",
        (after) => `Moved to ${dayLabel(after.day)}, ${formatClock(after.start)} – ${formatClock(after.end)}`);
      return { ...res, clamped: iv.clamped };
    }

    /**
     * While dragging: quick O(n) check of the moved event only, nothing saved
     */
    dragPreview(id, proposed) {
      const ev = this.#store.getEvent(id);
      if (!ev) return { interval: null, conflicts: [], clamped: false };
      const iv = clampDrag(proposed);
      const day = proposed.day || ev.day;
      const target = { id, start: iv.start, end: iv.end };
      return { interval: { day, start: iv.start, end: iv.end }, conflicts: conflictsFor(target, this.#store.eventsOn(day)), clamped: iv.clamped };
    }

    #change(id, changes, type, messageFor) {
      const { before, after } = this.#store.updateEvent(id, changes);
      this.#history.push(`${type === "move" ? "Move" : "Edit"} ${before.title}`, () => {
        this.#store.updateEvent(id, editableFields(before));
        return [before.day, after.day];
      });
      this.#recompute([before.day, after.day], { type, eventId: id }); // both days: a move can clear a clash on the old day
      return this.#eventResult(after, messageFor(after));
    }

    // delete

    /** Delete an event. If it came from a task, the task goes back to Unplaced. */
    deleteEvent(id) {
      const ev = this.#store.removeEvent(id);
      if (!ev) return notFound("event");

      let taskBefore = null;
      if (ev.sourceTaskId) {
        taskBefore = this.#store.getTask(ev.sourceTaskId);
        if (taskBefore) this.#store.updateTask(taskBefore.id, { status: TASK_STATUS.UNPLACED, scheduledEventId: null });
      }

      this.#history.push(`Delete ${ev.title}`, () => {
        this.#store.addEvent(ev);
        if (taskBefore && this.#store.hasTask(taskBefore.id)) {
          this.#store.updateTask(taskBefore.id, { status: taskBefore.status, scheduledEventId: taskBefore.scheduledEventId });
        }
        return [ev.day];
      });
      this.#recompute([ev.day], { type: "delete", eventId: id, tasksChanged: !!taskBefore });
      return { ok: true, event: ev, taskReturned: !!taskBefore, message: `Deleted ${ev.title}` };
    }

    // tasks

    /** Create a flexible task from the New task form. */
    createTask(form) {
      const v = validateTaskForm(form);
      if (!v.ok) return v;
      const task = this.#store.addTask(v.value);
      this.#history.push(`Add task ${task.name}`, () => {
        this.#store.removeTask(task.id);
        return [];
      });
      this.#recompute([], { type: "createTask", taskId: task.id, tasksChanged: true });
      return { ok: true, task, message: "Task added" };
    }

    /** Delete a task. If it was scheduled, its event stays but is unlinked. */
    deleteTask(id) {
      const task = this.#store.getTask(id);
      if (!task) return notFound("task");
      const linked = task.scheduledEventId ? this.#store.getEvent(task.scheduledEventId) : null;
      if (linked) this.#store.updateEvent(linked.id, { sourceTaskId: null });
      this.#store.removeTask(id);
      if (this.#search && this.#search.taskId === id) this.#search = null;

      this.#history.push(`Delete task ${task.name}`, () => {
        this.#store.addTask(task);
        if (linked && this.#store.hasEvent(linked.id)) this.#store.updateEvent(linked.id, { sourceTaskId: id });
        return linked ? [linked.day] : [];
      });
      this.#recompute(linked ? [linked.day] : [], { type: "deleteTask", taskId: id, tasksChanged: true });
      return { ok: true, task, message: `Deleted task ${task.name}` };
    }

    /**
     * Flow C: find the best times for a task.
     * windowForm: { date, start?, end? } ("HH:MM"; missing = working hours)
     * options.breaks: [{ start: "13:00", end: "14:00" }]
     * Returns { ok: true, window, recommendations } or ER1 errors or { ok: false, error } (ER3/ER4).
     */
    findTimes(taskId, windowForm, options = {}) {
      const task = this.#store.getTask(taskId);
      if (!task) return notFound("task");
      const w = validateWindowForm(windowForm, this.#workingHours);
      const b = validateBreaks(options.breaks || []);
      if (!w.ok || !b.ok) return { ok: false, errors: [...(w.errors || []), ...(b.errors || [])] };

      const result = this.#runSearch(task, w.value, b.value);
      this.#search = { taskId, window: w.value, breaks: b.value, result };
      return result.ok ? { ok: true, window: w.value, recommendations: result.recommendations } : result;
    }

    /**
     * The user picked a suggestion: the task becomes an event (re-entering
     * Flow A, so it gets the same conflict check) and is linked to it.
     */
    acceptSlot(taskId, recommendation) {
      const task = this.#store.getTask(taskId);
      if (!task) return notFound("task");
      if (task.status !== TASK_STATUS.UNPLACED) {
        return { ok: false, errors: [{ code: "ALREADY_SCHEDULED", message: `${task.name} is already on the calendar.` }] };
      }
      const ev = this.#store.addEvent(toEvent(task, recommendation.day, recommendation.slot));
      this.#store.updateTask(taskId, { status: TASK_STATUS.SCHEDULED, scheduledEventId: ev.id,
        window: { day: recommendation.day, start: recommendation.slot.start, end: recommendation.slot.end } });
      if (this.#search && this.#search.taskId === taskId) this.#search = null;

      this.#history.push(`Schedule ${task.name}`, () => {
        this.#store.removeEvent(ev.id);
        if (this.#store.hasTask(taskId)) this.#store.updateTask(taskId, { status: TASK_STATUS.UNPLACED, scheduledEventId: null });
        return [ev.day];
      });
      this.#recompute([ev.day], { type: "accept", eventId: ev.id, taskId, tasksChanged: true });
      return this.#eventResult(ev, `${task.name} scheduled`);
    }

    /**
     * "Find another time" for an event that clashes: same length, same day
     * by default, the event's own time not counted as busy.
     */
    findAnotherTime(eventId, windowForm = null, options = {}) {
      const ev = this.#store.getEvent(eventId);
      if (!ev) return notFound("event");
      const w = validateWindowForm(windowForm || { date: ev.day }, this.#workingHours);
      const b = validateBreaks(options.breaks || []);
      if (!w.ok || !b.ok) return { ok: false, errors: [...(w.errors || []), ...(b.errors || [])] };
      try {
        const recs = findAlternativesFor(ev, this.#store.eventsOn(w.value.day), w.value, { breaks: b.value });
        return { ok: true, window: w.value, recommendations: recs };
      } catch (e) {
        return schedulingFailure(e);
      }
    }

    // ============================================================ undo

    /** Reverse the last change. Returns { ok, message }. */
    undo() {
      const entry = this.#history.pop();
      if (!entry) return { ok: false, message: "Nothing to undo" };
      const days = entry.undo();
      this.#recompute(days, { type: "undo", tasksChanged: true });
      return { ok: true, message: `Undone: ${entry.label}` };
    }

    // ============================================================ import / export

    exportCalendar() {
      if (!this.#persistence) throw new Error("export needs a Persistence");
      return this.#persistence.exportJSON();
    }

    /** Replace the calendar from an exported file. Bad file -> error, calendar unchanged. */
    importCalendar(text) {
      if (!this.#persistence) throw new Error("import needs a Persistence");
      try {
        const res = this.#persistence.importJSON(text);
        this.#history.clear();
        this.#search = null;
        this.#store.invalidateAll();
        this.#conflicts.clear();
        const days = this.#store.days();
        for (const d of days) this.#recheckDay(d);
        this.#render(days, { type: "import", tasksChanged: true });
        return { ok: true, ...res, message: `Imported ${res.events} events` };
      } catch (e) {
        return { ok: false, error: { code: e.code || "BAD_IMPORT", message: e.message } };
      }
    }

    // pipeline

    /**
     * One path for every change, so what the UI shows always
     * matches the current events.
     */
    #recompute(days, info) {
      const delta = Array.from(new Set(days.filter(Boolean)));
      for (const d of delta) {
        this.#store.invalidate(d);
        this.#recheckDay(d);
      }
      if (this.#search && delta.includes(this.#search.window.day)) {
        const task = this.#store.getTask(this.#search.taskId);
        if (!task || task.status !== TASK_STATUS.UNPLACED) {
          this.#search = null;
        } else {
          this.#search = { ...this.#search, result: this.#runSearch(task, this.#search.window, this.#search.breaks) };
          info = { ...info, searchRefreshed: true };
        }
      }
      if (this.#persistence) this.#persistence.scheduleSave();
      this.#render(delta, info);
    }

    #recheckDay(day) {
      const found = detectConflicts(this.#store.eventsOn(day));
      if (found.length) this.#conflicts.set(day, found);
      else this.#conflicts.delete(day);
    }

    #runSearch(task, window, breaks) {
      try {
        return { ok: true, recommendations: findBestSlotsInStore(this.#store, task, window, { breaks }) };
      } catch (e) {
        return schedulingFailure(e);
      }
    }

    #eventResult(ev, message) {
      const conflicts = this.conflictsForEvent(ev.id);
      let alternatives = [];
      if (conflicts.length) {
        const alt = this.findAnotherTime(ev.id);
        if (alt.ok) alternatives = alt.recommendations;
      }
      return { ok: true, event: ev, conflicts, alternatives, message };
    }
  }

  return { App, dayLabel };
});
