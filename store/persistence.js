/**
 * store/persistence.js
 *
 * Saves the EventStore to localStorage and loads it back
 * (Assignment 2 section 6, Assignment 3 risk R5 and section 5.5).
 *
 *   - Saves a short pause after the last change (debounced), not on every
 *     change, so dragging and quick edits stay smooth.
 *   - Saved data is versioned: { app, version, savedAt, events, tasks }.
 *   - Loading checks everything. Corrupt data never half-loads: the store
 *     starts empty, the bad text is kept under a backup key, and load()
 *     returns a warning for the UI.
 *   - A failed save (storage full or blocked) is reported, never thrown, so
 *     the UI can show "Couldn't save" with Try again / Export events.
 *   - Export / import the whole calendar as a JSON file. Import is
 *     all-or-nothing.
 *
 * The storage and timer functions can be passed in, so tests run in Node
 * with a fake storage and no real waiting.
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

  const APP_ID = "smart-scheduler";
  const FORMAT_VERSION = 1;
  const DEFAULT_KEY = "smartScheduler.data";
  const DEFAULT_DELAY_MS = 300;

  /** code: BAD_FORMAT | NEWER_VERSION | BAD_IMPORT */
  class PersistenceError extends Error {
    constructor(code, message) {
      super(message);
      this.name = "PersistenceError";
      this.code = code;
    }
  }

  /**
   * The browser's localStorage if it works, otherwise null.
   * (Access can throw in private modes or with storage disabled.)
   */
  function defaultStorage() {
    try {
      const s = typeof globalThis !== "undefined" ? globalThis.localStorage : undefined;
      if (!s) return null;
      const probe = "__ss_probe__";
      s.setItem(probe, "1");
      s.removeItem(probe);
      return s;
    } catch (e) {
      return null;
    }
  }

  function isQuotaError(err) {
    return !!err && (err.name === "QuotaExceededError" || err.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      err.code === 22 || err.code === 1014);
  }

  /** Wrap store data in the versioned save format. */
  function toSaveFormat(data) {
    return {
      app: APP_ID,
      version: FORMAT_VERSION,
      savedAt: new Date().toISOString(),
      events: data.events,
      tasks: data.tasks,
    };
  }

  /**
   * Check the outer shape and version, and upgrade older versions.
   * Returns { events, tasks } ready for store.loadData (which checks every
   * record). Throws PersistenceError.
   */
  function fromSaveFormat(obj) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      throw new PersistenceError("BAD_FORMAT", "saved data is not an object");
    }
    if (obj.app !== APP_ID) {
      throw new PersistenceError("BAD_FORMAT", "this is not a Smart Scheduler file");
    }
    if (!Number.isInteger(obj.version) || obj.version < 1) {
      throw new PersistenceError("BAD_FORMAT", "saved data has no valid version");
    }
    if (obj.version > FORMAT_VERSION) {
      throw new PersistenceError("NEWER_VERSION",
        `saved data is version ${obj.version}, this app reads up to version ${FORMAT_VERSION}`);
    }
    // Future upgrades go here, one step at a time:
    //   if (obj.version === 1) obj = upgrade1to2(obj);
    if (!Array.isArray(obj.events) || !Array.isArray(obj.tasks)) {
      throw new PersistenceError("BAD_FORMAT", "saved data must contain events and tasks lists");
    }
    return { events: obj.events, tasks: obj.tasks };
  }

  class Persistence {
    #store;
    #storage;
    #key;
    #delay;
    #setTimer;
    #clearTimer;
    #timer = null;
    #onSaved;
    #onSaveError;

    /**
     * @param {EventStore} store
     * @param {object} [options]
     *   storage      object with getItem/setItem/removeItem (default: localStorage)
     *   key          storage key (default "smartScheduler.data")
     *   delayMs      pause before saving (default 300)
     *   onSaved      called after each successful save
     *   onSaveError  called with { code, reason, message } when a save fails
     *   setTimer / clearTimer   for tests (default setTimeout / clearTimeout)
     */
    constructor(store, options = {}) {
      this.#store = store;
      this.#storage = "storage" in options ? options.storage : defaultStorage();
      this.#key = options.key || DEFAULT_KEY;
      this.#delay = options.delayMs ?? DEFAULT_DELAY_MS;
      this.#onSaved = options.onSaved || (() => {});
      this.#onSaveError = options.onSaveError || (() => {});
      this.#setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
      this.#clearTimer = options.clearTimer || ((t) => clearTimeout(t));
    }

    /** False when the browser blocks storage; the app still works for this session. */
    get available() {
      return this.#storage !== null;
    }

    /** True while a save is waiting for its pause to end. */
    get pending() {
      return this.#timer !== null;
    }

    /**
     * Load saved data into the store. Call once at start-up.
     * Returns one of:
     *   { status: "loaded", events, tasks }   counts
     *   { status: "empty" }                   nothing saved yet
     *   { status: "unavailable", warning }    storage blocked
     *   { status: "corrupt", warning }        bad data; store left empty,
     *                                         raw text kept at <key>.corrupt
     */
    load() {
      if (!this.#storage) {
        return { status: "unavailable", warning: "This browser is blocking storage, so changes won't be kept after you close the page." };
      }

      let raw;
      try {
        raw = this.#storage.getItem(this.#key);
      } catch (e) {
        return { status: "unavailable", warning: "Saved data couldn't be read from this browser." };
      }
      if (raw === null || raw === undefined) return { status: "empty" };

      try {
        const data = fromSaveFormat(JSON.parse(raw));
        this.#store.loadData(data);
        return { status: "loaded", events: data.events.length, tasks: data.tasks.length };
      } catch (err) {
        this.#store.clear();
        try {
          this.#storage.setItem(this.#key + ".corrupt", raw);
        } catch (e) {
          // backup is best-effort
        }
        return {
          status: "corrupt",
          warning: "Your saved calendar couldn't be read, so an empty calendar was opened. A copy of the old data was kept.",
          reason: err && err.message,
        };
      }
    }

    /** Ask for a save after a short pause. Call after every change. */
    scheduleSave() {
      if (this.#timer !== null) this.#clearTimer(this.#timer);
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        this.saveNow();
      }, this.#delay);
    }

    /**
     * Save right away. Never throws.
     * Returns { ok: true } or { ok: false, error: { code: "SAVE_FAILED", reason, message } }.
     */
    saveNow() {
      if (this.#timer !== null) {
        this.#clearTimer(this.#timer);
        this.#timer = null;
      }
      if (!this.#storage) return this.#fail("UNAVAILABLE", "This browser is blocking storage.");

      let text;
      try {
        text = JSON.stringify(toSaveFormat(this.#store.toData()));
      } catch (err) {
        return this.#fail("SERIALIZE", "The calendar couldn't be prepared for saving.");
      }
      try {
        this.#storage.setItem(this.#key, text);
      } catch (err) {
        return isQuotaError(err)
          ? this.#fail("QUOTA", "Browser storage is full.")
          : this.#fail("WRITE", "The browser refused to save.");
      }
      this.#onSaved();
      return { ok: true };
    }

    /** Save now if a save is waiting. Use on page close (beforeunload). */
    flush() {
      return this.#timer !== null ? this.saveNow() : { ok: true };
    }

    /** The whole calendar as JSON text, for the Export events button. */
    exportJSON() {
      return JSON.stringify(toSaveFormat(this.#store.toData()), null, 2);
    }

    /**
     * Replace the calendar with the contents of an exported file.
     * All-or-nothing: on any problem it throws PersistenceError("BAD_IMPORT")
     * and the calendar is unchanged. On success it saves right away.
     */
    importJSON(text) {
      let data;
      try {
        data = fromSaveFormat(JSON.parse(text));
        this.#store.loadData(data);
      } catch (err) {
        throw new PersistenceError("BAD_IMPORT", "This file couldn't be imported: " + (err && err.message));
      }
      const saved = this.saveNow();
      return { events: data.events.length, tasks: data.tasks.length, saved: saved.ok };
    }

    #fail(reason, message) {
      const error = { code: "SAVE_FAILED", reason, message: message + " The change is on screen but will be lost on reload." };
      this.#onSaveError(error);
      return { ok: false, error };
    }
  }

  return { Persistence, PersistenceError, FORMAT_VERSION, toSaveFormat, fromSaveFormat };
});
