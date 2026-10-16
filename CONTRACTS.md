# Data contracts

Shared shapes between the logic (Megha) and the UI (Yashita).
Do not change a shape without telling the other person.

All times are **integer minutes from midnight** (0–1440). Intervals are
**half-open** `[start, end)`, so 10:00–11:00 and 11:00–12:00 do not clash.
`day` is always a `"YYYY-MM-DD"` string. Events never cross midnight.

## Event (store/records.js)
| Field | Type | Notes |
|---|---|---|
| id | string | generated if missing |
| title | string | required, trimmed |
| day | "YYYY-MM-DD" | |
| start, end | integer | 0 ≤ start < end ≤ 1440 |
| description | string | may be empty |
| priority | "low" \| "medium" \| "high" | required |
| category | "meeting" \| "class" \| "appointment" \| "assignment" \| "personal task" | empty → "personal task" |
| sourceTaskId | string \| null | set when created from a task |

## Task (store/records.js)
| Field | Type | Notes |
|---|---|---|
| id | string | |
| name | string | required |
| duration | integer | minutes, 1–1440 |
| priority | "low" \| "medium" \| "high" | |
| window | { day, start, end } \| null | set by Find a time |
| deadline | { day, minute } \| null | |
| status | "unplaced" \| "scheduled" | |
| scheduledEventId | string \| null | set exactly when status is "scheduled" |

## Conflict (conflict/)
`{ eventA, eventB, overlapStart, overlapEnd, overlapMinutes }`

## Recommendation (scheduling/)
`{ slot, containingGap, boundedBefore, boundedAfter, slackBefore, slackAfter,
   scoreTotal, scoreBreakdown: { earliness, fitTightness, deadlineUrgency, workingHours },
   reason, rank }`

## Errors shown to the user (application/)
`{ code: "ER1" | "ER2" | "ER3" | "ER4", field?, message, data? }`
For ER4, `data.longestGap = { start, end }` (the closest miss shown on screen).

## Store API (store/eventStore.js)
- Events: `addEvent(fields)`, `getEvent(id)`, `updateEvent(id, changes) → { before, after }`,
  `removeEvent(id)`, `eventsOn(day)`, `eventsIn({ day, start, end })`, `allEvents()`, `days()`
- Tasks: `addTask`, `getTask`, `updateTask → { before, after }`, `removeTask`, `allTasks`, `unplacedTasks`
- Cache: `getBusy/putBusy(day)`, `getRecommendations/putRecommendations(day)`, `invalidate(day)`
- Saving: `toData()`, `loadData({ events, tasks })` (all-or-nothing)

Records are frozen. To change one, call `updateEvent` / `updateTask`.
