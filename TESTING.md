# Testing — Smart Scheduler

How correctness and performance are checked, following the plan in
Assignment 3, section 3. All commands run from the project folder
(on Windows PowerShell use `npm.cmd` instead of `npm`).

| Command | What it does |
|---|---|
| `npm test` | Runs all 141 unit, integration and white-box tests |
| `npm run test:coverage` | Same, plus a line/branch coverage report |
| `npm run test:mutation` | Plants 21 realistic bugs one at a time; every one must be caught |
| `npm run perf` | Scaling from 100 to 100,000 intervals, and the 500-event targets |

Tests also run automatically on every pull request (GitHub Actions).

## 1. Black-box tests (from the specification)

Expected outputs come from the requirements, not from the code.

| Test | Scenario | Expected | Where |
|---|---|---|---|
| T1 | 09:00–10:00, add 10:00–11:00 | Saved, no conflict | `tests/conflict/detectConflicts.test.js` |
| T2 | 09:00–12:00, add 10:00–11:00 | Saved and flagged, 60-min overlap | `tests/conflict/…`, `tests/application/app.test.js` |
| T3 | 10:00–11:00, 10:30–12:00, 14:00–15:00 in 09:00–18:00 | Gaps 09–10, 12–14, 15–18 | `tests/scheduling/intervals.test.js` |
| T4 | 60-min task, only gap 13:00–14:00 | That slot, with explanation | `tests/scheduling/findBestSlots.test.js` |
| T5 | Event 10:00 to 09:00 | ER1 message, nothing saved | `tests/application/*.test.js` |
| T6 | 120-min task, window 14:00–15:00 | ER3 "window too short" | `tests/scheduling/findBestSlots.test.js` |
| T7 | Move a conflicting event Monday → Tuesday | Monday's conflict clears | `tests/application/app.test.js` |
| T8 | Drag end of 10:00–11:00 up to 10:10 | Stops at 10:15, no error, rechecked | `tests/application/app.test.js` |
| T9 | 500 events, add one | Under 500 ms | `tests/application/app.test.js`, `npm run perf` |

Every error case is covered: ER1 (each form field), ER2 (overlap kept and
flagged), ER3 (checked before the store is read), ER4 (with the closest-miss
gap), plus corrupt saved data, full storage and blocked storage.

## 2. White-box tests (from the code)

**Equivalence classes** for two intervals: disjoint, touching, partial,
nested, containing, identical — each tested in both orders.

**Boundaries**, each tested on and on both sides: event length 0 and 1 minute;
times 0 and 1440 against −1 and 1441; touching events; a gap exactly the task
length; a window exactly the task length; leftover gaps of 14 against 15 minutes.

**MC/DC** (`tests/whitebox/mcdc.test.js`): each condition in a compound
decision is shown to change the result on its own.

Overlap test `a.start < b.end && b.start < a.end` — 3 cases instead of 4:

| Case | a.start < b.end | b.start < a.end | Result |
|---|---|---|---|
| 1 | T | T | overlap |
| 2 | **F** | T | no overlap (only condition 1 changed) |
| 3 | T | **F** | no overlap (only condition 2 changed) |

Fragmentation filter `(0 < rb && rb < 15) || (0 < ra && ra < 15)` — 6 cases,
each pair differing in exactly one condition (see the test file for the table).
Also covered: the sweep eviction `size > 0 && end <= start`, the merge
condition `start <= last.end`, and the complement condition `start > cursor`.

**Oracles** (random seeded calendars, so failures are reproducible):

| Fast algorithm | Checked against |
|---|---|
| Sweep-line conflicts (300 days) | All-pairs O(n²) comparison |
| Merge and free gaps (200 days each) | A 1,440-minute busy array |
| Best-time finder (300 days) | Every slot is free, inside its gap and the window, fits, leaves 0 or ≥ 15 min |
| Drag check | Agrees with the full sweep for that event |
| Store day index (2,000 random operations) | A plain array model |
| Min-heap (3,000 operations) | A sorted array |

Invariant: busy + free = window, checked on every random window.

**Coverage** (`npm run test:coverage`): **97.7% of lines, 90.7% of branches,
99.5% of functions.** The remaining lines are the browser half of each file's
loader (run by `tests/store/browser-load.test.js`, which the coverage tool cannot see),
the localStorage detection that only runs in a real browser, and one defensive re-throw.

## 3. Seeded faults (mutation testing)

`npm run test:mutation` copies the project, plants one bug, runs every test,
and repeats for 21 bugs. **21 / 21 are caught.**

| # | Planted bug | Caught by |
|---|---|---|
| 1 | Overlap test `<` changed to `<=` (touching = clash) | interval tests |
| 2 | Record allows start == end | records tests |
| 3 | `eventsIn` includes events touching the window | store tests |
| 4 | Store forgets the old day's cache on a move | cache test |
| 5 | Corrupt saved data not cleared | persistence tests |
| 6 | Sweep keeps touching events active | T1, oracle |
| 7 | Overlap end measured wrongly | T2, oracle |
| 8 | Drag check flags touching events | drag tests |
| 9 | Heap compares the wrong way | heap tests, oracle |
| 10 | Merge stops fusing touching blocks | merge tests, oracle |
| 11 | Merge shrinks a block when a nested interval follows | oracle |
| 12 | Complement moves its cursor backwards | oracle |
| 13 | ER3 rejects a window exactly the task length | boundary test |
| 14 | Fragment filter rejects a 15-minute leftover | MC/DC boundary |
| 15 | Exact-fit gaps skipped | T4 |
| 16 | Deadline urgency drops to 0 instead of fading | deadline test |
| 17 | Priority ignored in ranking | priority test |
| 18 | ER1 misses end == start | validation tests |
| 19 | Drag no longer stops at 15 minutes | clamp test |
| 20 | **R1:** a move rechecks only the new day | T7 |
| 21 | Deleting a task's event doesn't return the task | Flow D test |

Mutation testing found one real gap during development: bug 19 first
survived, because no test dragged an event's end so it rounded onto its start
(10:00–10:07 → 10:00–10:00). A test for that case was added.

## 4. Performance

`npm run perf`, median of 20 runs after warm-up. Example run:

| n | Sweep-line | Merge | Complement | Conflicts k |
|---|---|---|---|---|
| 100 | 0.08 ms | 0.02 ms | 0.01 ms | 57 |
| 1,000 | 0.39 ms | 0.04 ms | 0.07 ms | 630 |
| 10,000 | 1.25 ms | 0.38 ms | 0.02 ms | 6,315 |
| 100,000 | 13.7 ms | 6.3 ms | 1.0 ms | 63,147 |

From 10,000 to 100,000 intervals the sweep line grew ×10.9 and merge ×16.8.
n log n predicts ×12.5 and quadratic growth would be ×100, so the algorithms
scale as designed. The complement step runs in about a millisecond or less at
every size, so its timings are dominated by memory and garbage-collection
effects rather than the algorithm (which is a single linear pass).

Targets with 500 events (Assignment 1 non-functional requirement 1):

| Target | Measured | Result |
|---|---|---|
| One edit under 500 ms | about 0.1 ms | Pass |
| Full recheck + scheduling under 1 s | about 0.4 ms | Pass |

Timings vary by machine; rerun `npm run perf` for your own numbers.

## 5. Still to do (with the UI)

- Scripted browser checks: add valid and invalid events, drag snapping, conflict markers, accepting a slot.
- Manual checks on Chrome, Firefox, Safari and a phone-width window.
- Accessibility checklist: keyboard-only use, screen reader labels, colour-independent conflict markers.
- A short session with real users.
