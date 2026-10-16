/**
 * application/history.js
 *
 * Undo stack. Each entry knows how to reverse one change and returns the
 * days it touched, so the app can recompute exactly those days.
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

  class UndoHistory {
    #entries = [];
    #limit;

    constructor(limit = 50) {
      this.#limit = limit;
    }

    /** @param {string} label  e.g. "Delete Gym"   @param {() => string[]} undo  returns affected days */
    push(label, undo) {
      this.#entries.push({ label, undo });
      if (this.#entries.length > this.#limit) this.#entries.shift();
    }

    pop() {
      return this.#entries.pop() || null;
    }

    get canUndo() {
      return this.#entries.length > 0;
    }

    /** Label of the change Undo would reverse, or null. */
    get nextLabel() {
      return this.#entries.length ? this.#entries[this.#entries.length - 1].label : null;
    }

    clear() {
      this.#entries = [];
    }
  }

  return { UndoHistory };
});
