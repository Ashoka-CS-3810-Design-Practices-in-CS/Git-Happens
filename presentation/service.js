
// The screens' link to the application layer (SS.App in application/app.js).
// Every change still goes through SS.App, so it is validated, rechecked for clashes, saved and
// redrawn exactly as CONTRACTS.md says. This file only translates:
//   - the screens work in minutes and "day". SS.App's forms take "HH:MM" text and "date"
//   - recommendations get slot.day so a card can show its own day,
//   - error fields are renamed to the form field the screen marks red,
//   - "Find a time" on a task that is not saved yet first saves it as an unplaced task.
// It also remembers when the user closes Find a time, because SS.App keeps the last search
// open until a slot is accepted.
(function () {
    "use strict";
   
    const req = typeof require !== "undefined" && typeof window === "undefined";
    const SS = req
      ? Object.assign({}, require("../store/records.js"), require("../conflict/detectConflicts.js"),
        require("../application/validation.js"), require("../store/persistence.js"))
      : window.SS;
    const Time = req ? require("./time.js") : window.Time;
   
    function create(deps) {
      const app = deps.app;
      const persistence = deps.persistence || null;
      const store = app.store;
      let closedSearch = null; // { taskId } of a search the user closed
   
      // ---------- translating forms and results ----------
   
      const renameFields = (errors, names) =>
        (errors || []).map((e) => Object.assign({}, e, { field: (names && names[e.field]) || e.field }));
   
      const EVENT_FIELDS = { date: "day" };
      const TASK_FIELDS = { deadlineDate: "deadline", deadlineTime: "deadline" };
      const WINDOW_FIELDS = { date: "window", start: "window", end: "window", breaks: "window" };
   
      function failed(r, names) {
        if (r.ok) return r;
        const errors = r.errors ? renameFields(r.errors, names) : null;
        return Object.assign({}, r, { errors, error: r.error || (errors && errors[0]) || null });
      }
   
      // Screen fields { title, day, start, end, ... } puts it into SS.App's event form.
      function eventForm(f) {
        return {
          title: f.title, date: f.day, start: f.start, end: f.end,
          description: f.description || "", priority: f.priority || "medium", category: f.category || SS.DEFAULT_CATEGORY
        };
      }
   
      // Screen fields { name, duration, priority, deadline: { day, minute } | null } puts it into SS.App's task form.
      function taskForm(f) {
        const d = f.deadline;
        return {
          name: f.name, duration: f.duration, priority: f.priority || "medium",
          deadlineDate: d ? d.day : "", deadlineTime: d ? (typeof d.minute === "number" ? Time.clock(d.minute) : d.minute) : ""
        };
      }
   
      const withDay = (rec) => Object.assign({}, rec, { slot: Object.assign({}, rec.slot, { day: rec.day }) });
   
      // Find-a-time results, ready for the cards and the ER3 / ER4 messages.
      function searchResult(r) {
        if (r.ok) return Object.assign({}, r, { recommendations: r.recommendations.map(withDay) });
        if (r.error && r.error.code === "ER4" && r.error.data && r.error.data.window) {
          const w = r.error.data.window;
          const message = "No free " + Time.duration(r.error.data.durationMinutes) + " on " + Time.dayLabel(w.day) +
            " between " + Time.clock(w.start) + " and " + Time.clock(w.end) + ".";
          return Object.assign({}, r, { error: Object.assign({}, r.error, { message }) });
        }
        return failed(r, WINDOW_FIELDS);
      }
   
      // ---------- reads ----------
   
      const conflictsOn = (day) => app.conflictsOn(day);
      function conflictedIds(day) {
        const ids = new Set();
        for (const c of app.conflictsOn(day)) { ids.add(c.eventA); ids.add(c.eventB); }
        return ids;
      }
   
      function search(query) {
        const q = (query || "").trim().toLowerCase();
        if (!q) return [];
        return store.allEvents().filter((e) => e.title.toLowerCase().includes(q) || e.description.toLowerCase().includes(q));
      }
   
      // ---------- events ----------
   
      const validateEvent = (form) => failed(SS.validateEventForm(eventForm(form)), EVENT_FIELDS);
      const createEvent = (form) => failed(app.createEvent(eventForm(form)), EVENT_FIELDS);
   
      // changes: any event fields. opts.source "drag" snaps to 15 minutes and never errors.
      function updateEvent(id, changes, opts) {
        const ev = store.getEvent(id);
        if (!ev) return { ok: false, errors: [{ code: "NOT_FOUND", message: "That event no longer exists." }] };
        const next = Object.assign({}, ev, changes);
        const r = opts && opts.source === "drag"
          ? app.moveEvent(id, { day: next.day, start: next.start, end: next.end })
          : app.updateEvent(id, eventForm(next));
        return r.ok ? Object.assign({}, r, { previous: ev }) : failed(r, EVENT_FIELDS);
      }
   
      // A suggested free time from "Find another time". 
      function moveToSlot(id, slot) {
        const ev = store.getEvent(id);
        if (!ev) return { ok: false, errors: [{ code: "NOT_FOUND", message: "That event no longer exists." }] };
        return updateEvent(id, { day: slot.day || ev.day, start: slot.start, end: slot.end });
      }
   
      function deleteEvent(id) {
        const r = app.deleteEvent(id);
        if (!r.ok) return failed(r);
        return Object.assign({}, r, { task: r.taskReturned ? store.getTask(r.event.sourceTaskId) : null });
      }
   
      // While dragging: the moved event against its day only (O(n_d)), nothing saved.
      const quickCheck = (ev) => SS.conflictsFor(ev, store.eventsOn(ev.day));
      const clampDrag = (start, end) => SS.clampDrag({ start, end });
   
      // ---------- tasks and Find a time ----------
   
      const createTask = (form) => failed(app.createTask(taskForm(form)), TASK_FIELDS);
      const deleteTask = (id) => failed(app.deleteTask(id));
   
      function sameTask(task, form) {
        const d = form.deadlineDate ? { day: form.deadlineDate, minute: SS.parseClock(form.deadlineTime) } : null;
        return task.name === String(form.name || "").trim() && task.duration === Number(form.duration) &&
          task.priority === form.priority &&
          (task.deadline === null ? d === null : d !== null && task.deadline.day === d.day && task.deadline.minute === d.minute);
      }
   
      // form: { taskId?, name, duration, priority, deadline, window: { day, start, end } }
      // The result also carries taskId, because a new or changed task gets saved first.
      function findTimes(form) {
        let task = form.taskId != null ? store.getTask(form.taskId) : null;
        const wanted = taskForm(form);
        if (!task || !sameTask(task, wanted)) {
          const made = app.createTask(wanted);
          if (!made.ok) return failed(made, TASK_FIELDS);
          if (task) app.deleteTask(task.id); // the old version of a task whose fields were changed here
          task = made.task;
        }
        closedSearch = null;
        const w = form.window || {};
        const r = app.findTimes(task.id, { date: w.day, start: w.start, end: w.end });
        return Object.assign(searchResult(r), { taskId: task.id });
      }
   
      function currentSearch() {
        const s = app.openSearch;
        if (!s || (closedSearch && closedSearch.taskId === s.taskId)) return null;
        const task = store.getTask(s.taskId);
        return task ? { task, window: s.window, result: searchResult(s.result) } : null;
      }
   
      function closeSearch() {
        const s = app.openSearch;
        closedSearch = s ? { taskId: s.taskId } : null;
      }
   
      function acceptSlot(taskId, rec) {
        const r = app.acceptSlot(taskId, rec);
        return r.ok ? Object.assign({}, r, { task: store.getTask(taskId) }) : failed(r);
      }
   
      const findAnotherTime = (eventId) => searchResult(app.findAnotherTime(eventId));
   
      // ---------- undo, saving, files ----------
   
      function undo() {
        const r = app.undo();
        return { ok: r.ok, label: r.ok ? r.message.replace(/^Undone: /, "") : "" };
      }
   
      const exportCalendar = () => app.exportCalendar();
      function importCalendar(text) {
        const r = app.importCalendar(text);
        return r.ok ? r : failed(r);
      }
      // The demo calendar, or an empty one: loaded the same way as an imported file.
      const loadData = (data) => importCalendar(JSON.stringify(SS.toSaveFormat({ events: data.events, tasks: data.tasks })));
      const saveNow = () => (persistence ? persistence.saveNow() : { ok: true });
   
      return {
        app, store,
        eventsOn: (day) => store.eventsOn(day),
        getEvent: (id) => store.getEvent(id),
        getTask: (id) => store.getTask(id),
        unplacedTasks: () => store.unplacedTasks(),
        conflictsOn, conflictedIds,
        conflictsFor: (id) => app.conflictsForEvent(id),
        canUndo: () => app.canUndo,
        search, validateEvent, createEvent, updateEvent, moveToSlot, deleteEvent, quickCheck, clampDrag,
        createTask, deleteTask, findTimes, currentSearch, closeSearch, acceptSlot, findAnotherTime,
        undo, exportCalendar, importCalendar, loadData, saveNow
      };
    }
   
    const Service = { create };
    if (req) module.exports = Service;
    else window.Service = Service;
  })();
   