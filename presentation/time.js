// Owner: Yashita (presentation layer)
// Date and clock helpers for the screens. Times are integer minutes from midnight (0..1440),
// days are "YYYY-MM-DD" strings, the same as in CONTRACTS.md. The logic below this layer never
// needs these: it works in minutes and only the screens turn them into "11:30" or "Thu 15 Oct".
(function () {
  "use strict";

  const MINUTES_PER_DAY = 1440;
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December"];

  const pad = (n) => String(n).padStart(2, "0");

  // "YYYY-MM-DD" -> whole days since 1970-01-01 (UTC, so no timezone or DST surprises).
  function dayNumber(day) {
    const [y, m, d] = day.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86400000);
  }

  function fromDayNumber(n) {
    const dt = new Date(n * 86400000);
    return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate());
  }

  function isValidDay(day) {
    if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    return fromDayNumber(dayNumber(day)) === day; // rejects 2026-02-30
  }

  const addDays = (day, n) => fromDayNumber(dayNumber(day) + n);
  const diffDays = (a, b) => dayNumber(a) - dayNumber(b);
  const weekday = (day) => new Date(dayNumber(day) * 86400000).getUTCDay(); // 0 = Sunday

  // Monday of the week containing day.
  function weekStart(day) {
    return addDays(day, -((weekday(day) + 6) % 7));
  }

  // Absolute minute on a single timeline, used to compare a slot with a deadline on another day.
  const absolute = (day, minute) => dayNumber(day) * MINUTES_PER_DAY + minute;

  // "HH:MM" -> minutes, or null when the text is not a real time. "24:00" is allowed as an end time.
  function parseClock(text) {
    if (typeof text === "number") return Number.isInteger(text) ? text : null;
    if (typeof text !== "string") return null;
    const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!m) return null;
    const h = Number(m[1]), min = Number(m[2]);
    if (min > 59 || h > 24 || (h === 24 && min !== 0)) return null;
    return h * 60 + min;
  }

  const clock = (m) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const range = (start, end) => clock(start) + " – " + clock(end);

  // 90 -> "1h 30m", 60 -> "1h", 45 -> "45m"
  function duration(m) {
    const h = Math.floor(m / 60), r = m % 60;
    if (h && r) return h + "h " + r + "m";
    return h ? h + "h" : r + "m";
  }

  function parts(day) {
    const [y, mo, d] = day.split("-").map(Number);
    return { y, mo, d };
  }

  // "Thu 15 Oct"
  function dayLabel(day) {
    const p = parts(day);
    return DOW[weekday(day)] + " " + p.d + " " + MONTHS[p.mo - 1];
  }

  // "Thu 15"
  const dayShort = (day) => DOW[weekday(day)] + " " + parts(day).d;

  const monthTitle = (day) => ({ month: MONTHS_LONG[parts(day).mo - 1], year: parts(day).y });

  function today(now) {
    const dt = now || new Date();
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }

  function nowMinute(now) {
    const dt = now || new Date();
    return dt.getHours() * 60 + dt.getMinutes();
  }

  const Time = {
    MINUTES_PER_DAY, DOW, MONTHS, MONTHS_LONG,
    dayNumber, fromDayNumber, isValidDay, addDays, diffDays, weekday, weekStart, absolute,
    parseClock, clock, range, duration, dayLabel, dayShort, monthTitle, today, nowMinute, parts
  };

  if (typeof module !== "undefined") module.exports = Time;
  else window.Time = Time;
})();
