"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventStore } = require("../../store/eventStore.js");
const { Persistence, PersistenceError, FORMAT_VERSION } = require("../../store/persistence.js");
const { ev } = require("../helpers.js");

/** In-memory stand-in for localStorage. */
function fakeStorage({ failWith } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failWith) throw failWith;
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

/** Timers we trigger by hand, so tests don't wait. */
function fakeTimers() {
  let next = 1;
  const timers = new Map();
  return {
    setTimer: (fn) => { const id = next++; timers.set(id, fn); return id; },
    clearTimer: (id) => timers.delete(id),
    count: () => timers.size,
    runAll: () => { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

function setup(opts = {}) {
  const store = new EventStore();
  const storage = opts.storage || fakeStorage();
  const timers = fakeTimers();
  const errors = [];
  let saves = 0;
  const p = new Persistence(store, {
    storage, setTimer: timers.setTimer, clearTimer: timers.clearTimer,
    onSaved: () => saves++, onSaveError: (e) => errors.push(e),
  });
  return { store, storage, timers, errors, p, saves: () => saves };
}

test("nothing saved yet -> empty", () => {
  const { p } = setup();
  assert.deepEqual(p.load(), { status: "empty" });
});

test("save then load into a new store restores everything", () => {
  const a = setup();
  a.store.addEvent(ev({ id: "e1" }));
  a.store.addTask({ id: "t1", name: "Gym", duration: 60, priority: "low" });
  assert.deepEqual(a.p.saveNow(), { ok: true });

  const saved = JSON.parse(a.storage.getItem("smartScheduler.data"));
  assert.equal(saved.app, "smart-scheduler");
  assert.equal(saved.version, FORMAT_VERSION);
  assert.ok(saved.savedAt);

  const b = setup({ storage: a.storage });
  assert.deepEqual(b.p.load(), { status: "loaded", events: 1, tasks: 1 });
  assert.equal(b.store.getEvent("e1").title, "Event");
  assert.equal(b.store.getTask("t1").name, "Gym");
});

test("scheduleSave waits for a pause and saves once for many changes", () => {
  const { store, timers, p, saves } = setup();
  store.addEvent(ev({ id: "e1" }));
  p.scheduleSave();
  p.scheduleSave();
  p.scheduleSave();
  assert.equal(timers.count(), 1);
  assert.equal(p.pending, true);
  assert.equal(saves(), 0);
  timers.runAll();
  assert.equal(saves(), 1);
  assert.equal(p.pending, false);
});

test("flush saves a waiting change immediately, and does nothing otherwise", () => {
  const { store, timers, p, saves } = setup();
  assert.deepEqual(p.flush(), { ok: true });
  assert.equal(saves(), 0);
  store.addEvent(ev());
  p.scheduleSave();
  p.flush();
  assert.equal(saves(), 1);
  assert.equal(timers.count(), 0);
});

const corruptCases = [
  ["not JSON", "{oops"],
  ["wrong app", JSON.stringify({ app: "other", version: 1, events: [], tasks: [] })],
  ["no version", JSON.stringify({ app: "smart-scheduler", events: [], tasks: [] })],
  ["newer version", JSON.stringify({ app: "smart-scheduler", version: 99, events: [], tasks: [] })],
  ["missing lists", JSON.stringify({ app: "smart-scheduler", version: 1 })],
  ["bad event", JSON.stringify({ app: "smart-scheduler", version: 1, tasks: [],
    events: [{ id: "x", title: "x", day: "2026-10-14", start: 600, end: 500, priority: "low" }] })],
];
for (const [name, raw] of corruptCases) {
  test(`corrupt data (${name}) -> empty store, warning, backup kept`, () => {
    const storage = fakeStorage();
    storage.setItem("smartScheduler.data", raw);
    const { store, p } = setup({ storage });
    store.addEvent(ev({ id: "leftover" }));
    const result = p.load();
    assert.equal(result.status, "corrupt");
    assert.match(result.warning, /empty calendar/);
    assert.equal(store.size, 0);
    assert.equal(storage.getItem("smartScheduler.data.corrupt"), raw);
  });
}

test("storage full -> save fails with QUOTA, reported not thrown", () => {
  const quota = Object.assign(new Error("full"), { name: "QuotaExceededError" });
  const { store, p, errors } = setup({ storage: fakeStorage({ failWith: quota }) });
  store.addEvent(ev());
  const result = p.saveNow();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "SAVE_FAILED");
  assert.equal(result.error.reason, "QUOTA");
  assert.match(result.error.message, /lost on reload/);
  assert.equal(errors.length, 1);
});

test("other write errors -> WRITE", () => {
  const { p } = setup({ storage: fakeStorage({ failWith: new Error("denied") }) });
  assert.equal(p.saveNow().error.reason, "WRITE");
});

test("no storage at all -> app still works, load and save say unavailable", () => {
  const store = new EventStore();
  const errors = [];
  const p = new Persistence(store, { storage: null, onSaveError: (e) => errors.push(e) });
  assert.equal(p.available, false);
  assert.equal(p.load().status, "unavailable");
  store.addEvent(ev());
  assert.equal(p.saveNow().error.reason, "UNAVAILABLE");
  assert.equal(errors.length, 1);
  assert.equal(store.size, 1);
});

test("a storage that throws on read -> unavailable", () => {
  const storage = fakeStorage();
  storage.getItem = () => { throw new Error("blocked"); };
  const { p } = setup({ storage });
  assert.equal(p.load().status, "unavailable");
});

test("export then import round trip, and import saves", () => {
  const a = setup();
  a.store.addEvent(ev({ id: "e1" }));
  a.store.addTask({ id: "t1", name: "Gym", duration: 60, priority: "low" });
  const text = a.p.exportJSON();

  const b = setup();
  b.store.addEvent(ev({ id: "old" }));
  const result = b.p.importJSON(text);
  assert.deepEqual(result, { events: 1, tasks: 1, saved: true });
  assert.equal(b.store.getEvent("old"), null);
  assert.equal(b.store.getEvent("e1").id, "e1");
  assert.ok(b.storage.getItem("smartScheduler.data"));
});

test("bad import throws BAD_IMPORT and leaves the calendar unchanged", () => {
  const { store, p } = setup();
  store.addEvent(ev({ id: "keep" }));
  const badFiles = [
    "not json",
    JSON.stringify({ hello: 1 }),
    JSON.stringify({ app: "smart-scheduler", version: 1, tasks: [],
      events: [ev({ id: "ok" }), { id: "bad", title: "", day: "2026-10-14", start: 1, end: 2, priority: "low" }] }),
  ];
  for (const text of badFiles) {
    assert.throws(() => p.importJSON(text), (e) => e instanceof PersistenceError && e.code === "BAD_IMPORT");
    assert.deepEqual(store.allEvents().map((e) => e.id), ["keep"]);
  }
});
