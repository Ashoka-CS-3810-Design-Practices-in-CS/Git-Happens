// Used by the black-box tests use to reach the app.
// Black-box tests only call SS.App's public functions, the same ones the screens use. 
// If the function names in SS.App change, this file will need to be updated.
"use strict";
const SS = Object.assign({},
  require("../../store/eventStore.js"),
  require("../../store/persistence.js"),
  require("../../scheduling/intervals.js"),
  require("../../application/app.js"));
 
const DEFAULTS = { priority: "medium", category: "class", description: "" };
 
function newCalendar(options) {
  const store = new SS.EventStore();
  const rendered = [];
  const app = new SS.App(store, Object.assign({ render: (days) => rendered.push(days) }, options));
  app.start();
 
  const form = (f) => ({ title: f.title, date: f.day, start: f.start, end: f.end,
    description: f.description, priority: f.priority, category: f.category });
 
  // A search needs a saved task.
  function findTimes(f) {
    let taskId = f.taskId;
    if (taskId == null) {
      const made = app.createTask({ name: f.name, duration: f.duration, priority: f.priority || "medium" });
      if (!made.ok) return made;
      taskId = made.task.id;
    }
    return app.findTimes(taskId, { date: f.window.day, start: f.window.start, end: f.window.end });
  }
 
  return {
    app, rendered,
    addEvent: (f) => app.createEvent(form(Object.assign({}, DEFAULTS, f))),
    // An edit through the form means that unchanged fields keep their current values.
    change: (id, changes) => {
      const ev = store.getEvent(id);
      return app.updateEvent(id, form(Object.assign({}, ev, changes)));
    },
    // A drag or resize, in minutes.
    drag: (id, changes) => {
      const ev = store.getEvent(id);
      return app.moveEvent(id, Object.assign({ day: ev.day, start: ev.start, end: ev.end }, changes));
    },
    remove: (id) => app.deleteEvent(id),
    get: (id) => store.getEvent(id),
    eventsOn: (day) => store.eventsOn(day),
    conflictsOn: (day) => app.conflictsOn(day),
    addTask: (f) => app.createTask(f),
    unplaced: () => store.unplacedTasks(),
    findTimes,
    // The free gaps in a window, as plain { start, end }.
    freeGaps: (window) => SS.complement(SS.mergeIntervals(SS.clipToWindow(store.eventsOn(window.day), window)), window)
      .map((g) => ({ start: g.start, end: g.end })),
    accept: (taskId, rec) => app.acceptSlot(taskId, rec),
    undo: () => app.undo(),
    loadData: (d) => { store.loadData(d); app.start(); }
  };
}
 
function reopenedWith(text) {
  const storage = { v: text, getItem() { return this.v; }, setItem(k, v) { this.v = v; }, removeItem() {} };
  const store = new SS.EventStore();
  const persistence = new SS.Persistence(store, { storage, setTimer: () => 0, clearTimer: () => {} });
  const app = new SS.App(store, { persistence });
  const result = app.start();
  return { cal: { eventsOn: (day) => store.eventsOn(day) }, result };
}
 
module.exports = { newCalendar, reopenedWith };
 