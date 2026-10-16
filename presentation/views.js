// Owner: Yashita (presentation layer)
// Week, day and month views. render(days) redraws only the day columns that changed,
// batched into one requestAnimationFrame so many changes cost one repaint.
(function () {
  "use strict";

  const { el, icon, CATEGORIES, catCss } = window.UI;
  const Time = window.Time;

  const HOUR = 60; // px per hour, so 1 minute = 1 px and top = start minute

  // Side-by-side lanes for events that overlap each other (presentation only; the clash list
  // itself comes from the Conflict layer).
  function lanes(events) {
    const sorted = events.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    const out = new Map();
    let cluster = [], clusterEnd = -1, laneEnds = [];
    const flush = () => {
      const n = laneEnds.length;
      for (const e of cluster) out.get(e.id).count = n;
      cluster = []; laneEnds = [];
    };
    for (const e of sorted) {
      if (e.start >= clusterEnd && cluster.length) flush();
      let lane = laneEnds.findIndex((end) => end <= e.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end); } else laneEnds[lane] = e.end;
      out.set(e.id, { lane, count: 1 });
      cluster.push(e);
      clusterEnd = Math.max(clusterEnd, e.end);
    }
    if (cluster.length) flush();
    return out;
  }

  function create(opts) {
    const { main, service, state, handlers } = opts;
    const columns = new Map(); // day -> column element currently on screen
    let pending = new Set();
    let frame = 0;

    const visibleDays = () => {
      if (state.view === "day") return [state.anchor];
      if (state.view === "week") {
        const start = Time.weekStart(state.anchor);
        return Array.from({ length: state.weekDays }, (_, i) => Time.addDays(start, i));
      }
      return [];
    };

    const shown = (ev) => !state.hidden.has(ev.category);

    function eventLabel(ev, conflicts) {
      let label = ev.title + ", " + Time.dayLabel(ev.day) + ", " + Time.range(ev.start, ev.end) + ", " +
        CATEGORIES[ev.category] + ", " + ev.priority + " priority";
      for (const c of conflicts) {
        const other = service.getEvent(c.eventA === ev.id ? c.eventB : c.eventA);
        if (other) label += ". Overlaps " + other.title + " by " + c.overlapMinutes + " minutes";
      }
      return label + ". Press Enter to edit, Alt and arrow keys to move.";
    }

    function eventBlock(ev, lane, conflicts) {
      const inClash = conflicts.length > 0;
      const width = lane.count > 1 ? Math.min(100, 100 / lane.count + 4) : 100;
      const left = lane.count > 1 ? (lane.lane * (100 - width)) / (lane.count - 1) : 0;
      const classes = ["cl-event"];
      if (inClash) classes.push("is-conflict");
      if (state.selectedId === ev.id) classes.push("is-selected");
      if (state.flash.has(ev.id)) classes.push("is-new");
      if (state.matchIds && state.matchIds.has(ev.id)) classes.push("is-match");
      const b = el("button", {
        class: classes.join(" "), "data-id": ev.id, "data-cat": catCss(ev.category), "aria-label": eventLabel(ev, conflicts),
        style: { top: ev.start + 1 + "px", height: Math.max(ev.end - ev.start - 2, 12) + "px", left: "calc(" + left + "% + 3px)", width: "calc(" + width + "% - 6px)", zIndex: 1 + lane.lane }
      });
      const title = el("span", { class: "cl-event__title" });
      if (inClash) title.append(icon("warn"));
      title.append(ev.title);
      b.append(title);
      if (ev.end - ev.start > 45) b.append(el("span", { class: "cl-event__time" }, Time.range(ev.start, ev.end)));
      b.append(el("span", { class: "ev-resize", "aria-hidden": "true", "data-resize": "end" }));
      return b;
    }

    function fillColumn(col, day) {
      col.replaceChildren();
      col.dataset.day = day;
      const events = service.eventsOn(day).filter(shown);
      const conflicts = service.conflictsOn(day).filter((c) => events.some((e) => e.id === c.eventA) && events.some((e) => e.id === c.eventB));
      const layout = lanes(events);
      for (const ev of events) {
        const mine = conflicts.filter((c) => c.eventA === ev.id || c.eventB === ev.id);
        col.append(eventBlock(ev, layout.get(ev.id), mine));
      }
      for (const c of conflicts) {
        const band = el("div", { class: "cl-overlap", style: { top: c.overlapStart + "px", height: c.overlapMinutes + "px" } });
        const label = el("button", { class: "cl-overlap__label", "aria-label": c.overlapMinutes + " minute overlap, show options" }, icon("warn"), c.overlapMinutes + " min overlap");
        label.addEventListener("click", (e) => { e.stopPropagation(); handlers.onOverlap(c, label); });
        band.append(label);
        col.append(band);
      }
      const search = service.currentSearch();
      if (search && search.result && search.result.ok && search.window.day === day) {
        for (const rec of search.result.recommendations) {
          const slot = el("button", {
            class: "cl-slot" + (state.chosenRank === rec.rank ? " is-chosen" : ""),
            style: { top: rec.slot.start + 1 + "px", height: rec.slot.end - rec.slot.start - 2 + "px" },
            "aria-label": "Suggestion " + rec.rank + ", " + Time.range(rec.slot.start, rec.slot.end)
          }, el("span", {}, search.task.name), el("span", {}, Time.range(rec.slot.start, rec.slot.end) + " · suggested"),
          el("span", { class: "cl-rank" + (rec.rank === 1 ? "" : " cl-rank--outline") }, rec.rank));
          slot.addEventListener("click", (e) => { e.stopPropagation(); handlers.onSuggestion(rec); });
          col.append(slot);
        }
      }
      if (day === Time.today()) col.append(el("div", { class: "cl-now", style: { top: Time.nowMinute() + "px" } }));
    }

    function renderGrid() {
      const days = visibleDays();
      columns.clear();
      const wrap = el("div", { class: "week" + (days.length > 1 ? " week--wide" : "") });
      wrap.style.setProperty("--days", days.length);
      const head = el("div", { class: "head" }, el("div"));
      for (const d of days) {
        const p = Time.parts(d);
        head.append(el("button", { onclick: () => handlers.onDayHeader(d), "aria-label": "Open " + Time.dayLabel(d) },
          Time.DOW[Time.weekday(d)], el("span", { class: "num" + (d === Time.today() ? " today" : "") }, p.d)));
      }
      const grid = el("div", { class: "cl-grid", style: { "--hours": 24 } });
      grid.style.setProperty("--days", days.length);
      grid.style.setProperty("--hours", 24);
      const hours = el("div", { class: "cl-hours" });
      for (let h = 1; h < 24; h++) hours.append(el("div", { class: "cl-hours__label", style: { top: h * HOUR + "px" } }, Time.clock(h * 60)));
      grid.append(hours);
      for (const d of days) {
        const col = el("div", { class: "cl-col" + ([0, 6].includes(Time.weekday(d)) ? " cl-col--weekend" : ""), role: "group", "aria-label": Time.dayLabel(d) });
        fillColumn(col, d);
        columns.set(d, col);
        grid.append(col);
      }
      wrap.append(head, grid);
      main.replaceChildren(wrap);
    }

    function renderMonth() {
      columns.clear();
      const first = state.anchor.slice(0, 8) + "01";
      const start = Time.weekStart(first);
      const month = Time.parts(first).mo;
      const grid = el("div", { class: "month", role: "grid", "aria-label": "Month" });
      for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.append(el("div", { class: "month__dow", role: "columnheader" }, d));
      for (let i = 0; i < 42; i++) {
        const d = Time.addDays(start, i);
        if (i === 35 && Time.parts(d).mo !== month) break;
        const events = service.eventsOn(d).filter(shown);
        const clash = service.conflictedIds(d);
        const cell = el("button", { class: "month__day" + (Time.parts(d).mo !== month ? " is-out" : ""), role: "gridcell",
          "aria-label": Time.dayLabel(d) + ", " + events.length + " events" + (clash.size ? ", has overlaps" : ""), onclick: () => handlers.onDayHeader(d) },
        el("span", { class: "month__num" + (d === Time.today() ? " today" : "") }, Time.parts(d).d));
        events.slice(0, 3).forEach((ev) => cell.append(el("span", { class: "month__chip" + (clash.has(ev.id) ? " is-conflict" : ""), "data-cat": catCss(ev.category) }, Time.clock(ev.start) + " " + ev.title)));
        if (events.length > 3) cell.append(el("span", { class: "month__more" }, "+" + (events.length - 3) + " more"));
        grid.append(cell);
      }
      main.replaceChildren(grid);
    }

    function renderAll() {
      cancelAnimationFrame(frame);
      pending.clear();
      if (state.view === "month") renderMonth();
      else renderGrid();
      handlers.afterRender && handlers.afterRender();
    }

    // Only the changed days are redrawn, in one animation frame.
    function render(days) {
      for (const d of days || []) pending.add(d);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const todo = pending;
        pending = new Set();
        if (state.view === "month") renderMonth();
        else for (const d of todo) { const col = columns.get(d); if (col) fillColumn(col, d); }
        handlers.afterRender && handlers.afterRender();
      });
    }

    const scrollToMinute = (m) => { main.scrollTop = Math.max(0, m - 30); };

    // Which day column and minute is under a point on screen (used by drag and click-to-add).
    function hit(x, y) {
      for (const [day, col] of columns) {
        const r = col.getBoundingClientRect();
        if (x >= r.left && x < r.right) return { day, col, minute: Math.round(y - r.top) };
      }
      return null;
    }

    return { renderAll, render, visibleDays, scrollToMinute, hit, columnFor: (d) => columns.get(d), lanes };
  }

  window.Views = { create, lanes, HOUR };
})();
