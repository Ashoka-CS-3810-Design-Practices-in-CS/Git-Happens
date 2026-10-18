/**
 * scripts/mutants.js   (run with: npm run test:mutation)
 *
 * Seeded-fault testing (Assignment 3 section 3): plants one small, realistic
 * bug at a time in a temporary copy of the project and runs the whole test
 * suite. Each bug must make at least one test fail ("killed").
 * A bug that survives means a gap in the tests.
 */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

const MUTANTS = [
  ["store/interval.js", "return this.start < other.end && other.start < this.end;",
   "return this.start <= other.end && other.start < this.end;", "overlap test: < becomes <= (touching = clash)"],
  ["store/records.js", "if (start >= end) {\n      throw new RecordError(field",
   "if (start > end) {\n      throw new RecordError(field", "record allows start == end"],
  ["store/eventStore.js", "if (ev.end > window.start) out.push(ev);",
   "if (ev.end >= window.start) out.push(ev);", "eventsIn includes events touching the window"],
  ["store/eventStore.js", "this.invalidate(before.day);\n      this.invalidate(after.day);",
   "this.invalidate(after.day);", "store forgets to drop the old day's cache on a move"],
  ["store/persistence.js", "this.#store.clear();\n        try {",
   "try {", "corrupt data is not cleared from the store"],
  ["conflict/detectConflicts.js", "active.peek().end <= x.start", "active.peek().end < x.start",
   "sweep keeps touching events active (false conflicts)"],
  ["conflict/detectConflicts.js", "const overlapEnd = Math.min(first.end, second.end);",
   "const overlapEnd = first.end;", "overlap end measured wrongly"],
  ["conflict/detectConflicts.js", "if (other.start < target.end && target.start < other.end) {",
   "if (other.start <= target.end && target.start < other.end) {", "drag check flags touching events"],
  ["conflict/minHeap.js", "if (l < a.length && this.#key(a[l]) < this.#key(a[smallest])) smallest = l;",
   "if (l < a.length && this.#key(a[l]) > this.#key(a[smallest])) smallest = l;", "heap sift-down compares the wrong way"],
  ["scheduling/intervals.js", "if (x.start <= last.end) {", "if (x.start < last.end) {",
   "merge no longer fuses touching blocks"],
  ["scheduling/intervals.js", "last.end = Math.max(last.end, x.end);", "last.end = x.end;",
   "merge shrinks a block when a nested interval follows"],
  ["scheduling/intervals.js", "cursor = Math.max(cursor, b.end);", "cursor = b.end;",
   "complement moves the cursor backwards"],
  ["scheduling/findBestSlots.js", "if (len < task.duration) {", "if (len <= task.duration) {",
   "ER3 rejects a window exactly as long as the task"],
  ["scheduling/findBestSlots.js", "return (before > 0 && before < minUseful) || (after > 0 && after < minUseful);",
   "return (before > 0 && before <= minUseful) || (after > 0 && after < minUseful);", "fragment filter rejects a 15-minute leftover"],
  ["scheduling/findBestSlots.js", "const fits = free.filter((g) => g.end - g.start >= d);",
   "const fits = free.filter((g) => g.end - g.start > d);", "exact-fit gaps are skipped"],
  ["scheduling/scoring.js", "deadlineUrgency: late === 0 ? 1 : Math.max(0, 1 - late / config.deadlineFadeMinutes),",
   "deadlineUrgency: late === 0 ? 1 : 0,", "deadline urgency drops to 0 instead of fading"],
  ["scheduling/scoring.js", "w.earliness *= config.priorityEarlinessFactor[task.priority] ?? 1;",
   "", "priority is ignored in ranking"],
  ["application/validation.js", "if (start !== null && start < 1440 && end !== null && end !== 0 && end <= start) {",
   "if (start !== null && start < 1440 && end !== null && end !== 0 && end < start) {", "ER1 misses end == start"],
  ["application/validation.js", "if (e - s < MIN_EVENT_MINUTES) {", "if (e - s < 0) {",
   "drag no longer stops at 15 minutes"],
  ["application/app.js", "this.#recompute([before.day, after.day], { type, eventId: id });",
   "this.#recompute([after.day], { type, eventId: id });", "R1: a move rechecks only the new day (stale conflict)"],
  ["application/app.js", "if (taskBefore) this.#store.updateTask(taskBefore.id, { status: TASK_STATUS.UNPLACED, scheduledEventId: null });",
   "", "deleting a task's event does not return the task to Unplaced"],
];

function copyProject(dest) {
  fs.cpSync(ROOT, dest, {
    recursive: true,
    filter: (src) => !/[\\/](\.git|node_modules)([\\/]|$)/.test(src),
  });
}

function runTests(cwd) {
  const r = spawnSync(process.execPath, ["--test"], { cwd, encoding: "utf8" });
  const failed = (r.stdout.match(/^# fail (\d+)/m) || [])[1];
  return { exit: r.status, failed: failed ? Number(failed) : null };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ss-mutants-"));
const clean = path.join(tmp, "clean");
copyProject(clean);
const baseline = runTests(clean);
if (baseline.exit !== 0) {
  console.error("The unmodified project already fails its tests. Fix those first.");
  process.exit(1);
}

let killed = 0;
const rows = [];
MUTANTS.forEach(([file, find, replace, description], i) => {
  const dir = path.join(tmp, "m" + i);
  copyProject(dir);
  const target = path.join(dir, file);
  const src = fs.readFileSync(target, "utf8");
  const count = src.split(find).length - 1;
  if (count !== 1) {
    rows.push([i + 1, "ERROR", file, `mutation text found ${count} times`]);
    return;
  }
  fs.writeFileSync(target, src.replace(find, replace));
  const r = runTests(dir);
  const isKilled = r.exit !== 0;
  if (isKilled) killed++;
  rows.push([i + 1, isKilled ? `killed (${r.failed} failing)` : "SURVIVED", file, description]);
  fs.rmSync(dir, { recursive: true, force: true });
});
fs.rmSync(tmp, { recursive: true, force: true });

for (const [n, status, file, description] of rows) {
  console.log(`${String(n).padStart(2)}  ${status.padEnd(20)} ${file.padEnd(30)} ${description}`);
}
console.log(`\n${killed}/${MUTANTS.length} seeded faults caught`);
process.exit(killed === MUTANTS.length ? 0 : 1);
