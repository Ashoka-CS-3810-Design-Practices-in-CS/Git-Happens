/**
 * tests/helpers.js - shared helpers for tests (not a test file itself).
 */
"use strict";

/** "09:30" -> 570. Keeps fixtures readable. */
function m(clock) {
  const [h, min] = clock.split(":").map(Number);
  return h * 60 + min;
}

/** Event fields with sensible defaults, so tests only state what matters. */
function ev(overrides = {}) {
  return { title: "Event", day: "2026-10-14", start: m("10:00"), end: m("11:00"), priority: "medium", ...overrides };
}

/** Small seeded random generator (same seed -> same sequence). */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

module.exports = { m, ev, rng };
