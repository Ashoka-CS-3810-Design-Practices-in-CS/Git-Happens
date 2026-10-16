/**
 * store/eventStore.js
 *
 * EventStore holds every Event and Task and the indexes built on them
 * (Assignment 2, sections 4.3, 4.4 and 4.6):
 *
 *   events   Map id -> Event                     get / has: O(1) average
 *   tasks    Map id -> Task                      get / has: O(1) average
 *   days     Map day -> Event[] sorted by start  insert / remove: O(n_d)
 *   cache    Map day -> { busy, recommendations } get / put / invalidate: O(1)
 *
 * Every Event is in exactly one day list, and each list is always sorted
 * by (start, end, id). Conflict and Scheduling get pre-sorted input, so
 * they never need to sort a day themselves.
 *
 * Mutations return what the application layer needs to compute the set of
 * affected days (delta): addEvent -> the event, updateEvent -> { before, after },
 * removeEvent -> the removed event.
 *
 * The store also drops the cache for every day an event mutation touches.
 * The application pipeline may still call invalidate(day); doing both is
 * harmless and guards against stale results (risk R1).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(Object.assign({}, require("./interval.js"), require("./records.js")));
  } else {
    root.SS = root.SS || {};
    Object.assign(root.SS, factory(root.SS));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (deps) {
  "use strict";

  const { createEvent, withChanges, createTask, withTaskChanges, isDayKey, TASK_STATUS } = deps;

  /** Thrown for store-level problems. code: NOT_FOUND | DUPLICATE_ID | BAD_DATA | BAD_WINDOW */
  class StoreError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "StoreError";
      this.code = code;
    }
  }

  /** Order inside a day list: start, then end, then id (so ties are stable). */
  function compareEvents(a, b) {
    if (a.start !== b.start) return a.start - b.start;
    if (a.end !== b.end) return a.end - b.end;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  }

  /** Binary search: first index whose element sorts after ev. O(log n_d). */
  function insertionIndex(list, ev) {
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (compareEvents(list[mid], ev) <= 0) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  class EventStore {
    #events = new Map();
    #tasks = new Map();
    #days = new Map();
    #cache = new Map();

    // ------------------------------------------------------ day index (private)

    #insertIntoDay(ev) {
      let list = this.#days.get(ev.day);
      if (!list) {
        list = [];
        this.#days.set(ev.day, list);
      }
      list.splice(insertionIndex(list, ev), 0, ev); // O(log n_d) search + O(n_d) shift
    }

    #removeFromDay(ev) {
      const list = this.#days.get(ev.day);
      if (!list) return;
      const i = list.indexOf(ev); // O(n_d); n_d is small
      if (i !== -1) list.splice(i, 1);
      if (list.length === 0) this.#days.delete(ev.day);
    }

    // ------------------------------------------------------------------ events

    /** Number of events stored. */
    get size() {
      return this.#events.size;
    }

    hasEvent(id) {
      return this.#events.has(id);
    }

    /** The Event with this id, or null. O(1) average. */
    getEvent(id) {
      return this.#events.get(id) ?? null;
    }

    /**
     * Add an event. Accepts a record from createEvent or plain fields
     * (it is re-checked either way). Returns the stored, frozen Event.
     */
    addEvent(fields) {
      const ev = createEvent(fields);
      if (this.#events.has(ev.id)) throw new StoreError("DUPLICATE_ID", `event ${ev.id} already exists`);
      this.#events.set(ev.id, ev);
      this.#insertIntoDay(ev);
      this.invalidate(ev.day);
      return ev;
    }

    /**
     * Change fields of an event (edit, move, resize, or move to another day).
     * Returns { before, after } so the caller knows the old and new day.
     * O(n_old + n_new).
     */
    updateEvent(id, changes) {
      const before = this.#events.get(id);
      if (!before) throw new StoreError("NOT_FOUND", `no event with id ${id}`);
      const after = withChanges(before, changes); // throws before anything is changed
      this.#removeFromDay(before);
      this.#events.set(id, after);
      this.#insertIntoDay(after);
      this.invalidate(before.day);
      this.invalidate(after.day);
      return { before, after };
    }

    /** Remove an event. Returns the removed Event, or null if there was none. */
    removeEvent(id) {
      const ev = this.#events.get(id);
      if (!ev) return null;
      this.#events.delete(id);
      this.#removeFromDay(ev);
      this.invalidate(ev.day);
      return ev;
    }

    /** Events on one day, sorted by start. Returns a copy. O(n_d). */
    eventsOn(day) {
      const list = this.#days.get(day);
      return list ? list.slice() : [];
    }

    /**
     * Events that overlap a single-day window { day, start, end }, sorted by
     * start. Events are NOT clipped; Scheduling clips them to the window.
     * Touching events (ending at window.start or starting at window.end)
     * are not included.
     */
    eventsIn(window) {
      if (!window || !isDayKey(window.day) || !Number.isInteger(window.start) ||
          !Number.isInteger(window.end) || window.start >= window.end) {
        throw new StoreError("BAD_WINDOW", "window must be { day, start, end } with start < end");
      }
      const list = this.#days.get(window.day);
      if (!list) return [];
      const out = [];
      for (const ev of list) {
        if (ev.start >= window.end) break; // sorted: nothing later can overlap
        if (ev.end > window.start) out.push(ev);
      }
      return out;
    }

    /** Every event, sorted by day then start. */
    allEvents() {
      const out = [];
      for (const day of this.days()) out.push(...this.#days.get(day));
      return out;
    }

    /** Day keys that currently have at least one event, in date order. */
    days() {
      return Array.from(this.#days.keys()).sort();
    }

    // ------------------------------------------------------------------- tasks

    hasTask(id) {
      return this.#tasks.has(id);
    }

    getTask(id) {
      return this.#tasks.get(id) ?? null;
    }

    addTask(fields) {
      const task = createTask(fields);
      if (this.#tasks.has(task.id)) throw new StoreError("DUPLICATE_ID", `task ${task.id} already exists`);
      this.#tasks.set(task.id, task);
      return task;
    }

    /** Returns { before, after }. */
    updateTask(id, changes) {
      const before = this.#tasks.get(id);
      if (!before) throw new StoreError("NOT_FOUND", `no task with id ${id}`);
      const after = withTaskChanges(before, changes);
      this.#tasks.set(id, after);
      return { before, after };
    }

    /** Remove a task. Returns it, or null if there was none. */
    removeTask(id) {
      const task = this.#tasks.get(id);
      if (!task) return null;
      this.#tasks.delete(id);
      return task;
    }

    allTasks() {
      return Array.from(this.#tasks.values());
    }

    /** Tasks shown in the "Unplaced tasks" list. */
    unplacedTasks() {
      return this.allTasks().filter((t) => t.status === TASK_STATUS.UNPLACED);
    }

    // ------------------------------------------------------- per-day cache

    /** Cached merged busy blocks for a day, or undefined. */
    getBusy(day) {
      const entry = this.#cache.get(day);
      return entry ? entry.busy : undefined;
    }

    putBusy(day, blocks) {
      this.#entry(day).busy = blocks;
    }

    /** Cached open recommendations for a day, or undefined. */
    getRecommendations(day) {
      const entry = this.#cache.get(day);
      return entry ? entry.recommendations : undefined;
    }

    putRecommendations(day, recommendations) {
      this.#entry(day).recommendations = recommendations;
    }

    /** Drop everything cached for one day. O(1). */
    invalidate(day) {
      this.#cache.delete(day);
    }

    invalidateAll() {
      this.#cache.clear();
    }

    #entry(day) {
      let entry = this.#cache.get(day);
      if (!entry) {
        entry = { busy: undefined, recommendations: undefined };
        this.#cache.set(day, entry);
      }
      return entry;
    }

    // ------------------------------------------------- whole-store helpers

    /** Plain data for saving: { events, tasks }. */
    toData() {
      return { events: this.allEvents().map((e) => ({ ...e })), tasks: this.allTasks().map((t) => ({ ...t })) };
    }

    /**
     * Replace everything with { events, tasks }. All-or-nothing: if any
     * record is bad, it throws and the store is left exactly as it was.
     */
    loadData(data) {
      if (!data || !Array.isArray(data.events) || !Array.isArray(data.tasks)) {
        throw new StoreError("BAD_DATA", "data must be { events: [], tasks: [] }");
      }
      const fresh = new EventStore();
      for (const t of data.tasks) fresh.addTask(t);
      for (const e of data.events) fresh.addEvent(e);
      this.#events = fresh.#events;
      this.#tasks = fresh.#tasks;
      this.#days = fresh.#days;
      this.#cache = new Map();
    }

    /** Remove all events, tasks and cached results. */
    clear() {
      this.#events = new Map();
      this.#tasks = new Map();
      this.#days = new Map();
      this.#cache = new Map();
    }
  }

  return { EventStore, StoreError, compareEvents };
});
