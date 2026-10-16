// Owner: Yashita (presentation layer)
// Draws the calendar and connects every button to Megha's application layer (SS.App).
// Loaded last. index.html creates the store, Persistence and SS.App, then calls
// Screens.start(app, persistence); SS.App calls Screens.render after every change.
(function () {
  "use strict";

  const { el, icon, CATEGORIES, catCss, announce, toast, download, typing } = window.UI;
  const Time = window.Time;

  // Filled in by start(). Calls that arrive before start() are ignored.
  let onRender = null, onSaved = null, onSaveError = null;

  function start(app, persistence) {
    const service = window.Service.create({ app, persistence });

    // ---------- view state ----------
    const state = {
      view: window.innerWidth < 768 ? "day" : "week",
      anchor: Time.today(),
      miniMonth: Time.today().slice(0, 8) + "01",
      weekDays: window.innerWidth < 1200 && window.innerWidth >= 768 ? 5 : 7,
      selectedId: null,
      hidden: new Set(),
      flash: new Set(),
      matchIds: null,
      chosenRank: 1
    };

    const $ = (id) => document.getElementById(id);
    const main = $("main"), panel = $("panel"), side = $("side"), scrim = $("scrim");

    // ---------- views ----------
    const views = window.Views.create({
      main, service, state,
      handlers: {
        onDayHeader: (d) => { state.anchor = d; setView("day"); },
        onOverlap: (c) => showClash(c),
        onSuggestion: (rec) => findTime.choose(rec.rank),
        afterRender: () => { renderTitle(); renderTasks(); renderMini(); }
      }
    });
    // SS.App's render(days, info): redraw only the days that changed, or everything after a load.
    onRender = (days, info) => {
      if (info && (info.type === "start" || info.type === "import")) views.renderAll();
      else views.render(days);
      if (info && info.searchRefreshed) findTime.refresh();
    };

    // ---------- panels ----------
    const editor = window.Editor.create({
      panel, service,
      onSaved: (r, isNew) => afterChange(r, isNew ? "Event added" : "Saved " + r.event.title),
      onDeleted: (r) => afterDelete(r),
      onMoved: (r) => afterChange(r, "Moved to " + Time.dayShort(r.event.day) + ", " + Time.range(r.event.start, r.event.end)),
      onClose: () => { state.selectedId = null; views.renderAll(); main.focus(); }
    });

    const findTime = window.FindTime.create({
      panel, service, state,
      onCreatedTask: (task) => {
        toast("Task added", [{ label: "Find a time", run: () => openFind({ taskId: task.id }) }]);
        renderTasks();
      },
      onSearched: (r, search) => {
        if (search && search.window && search.window.day !== state.anchor && state.view !== "month") {
          const visible = views.visibleDays().includes(search.window.day);
          if (!visible) { state.anchor = search.window.day; views.renderAll(); return; }
        }
        views.renderAll();
        if (r.ok) views.scrollToMinute(r.recommendations[0].slot.start - 60);
      },
      onAccepted: (r) => {
        const visible = views.visibleDays().includes(r.event.day);
        const actions = [{ label: "Undo", run: undo }];
        if (!visible) actions.push({ label: "View", run: () => goTo(r.event) });
        flash(r.event.id);
        views.renderAll();
        toast(r.task.name + " scheduled", actions);
      },
      onClose: () => { views.renderAll(); main.focus(); }
    });

    function closePanels() {
      editor.close();
      findTime.close();
    }

    function openEditor(args) {
      closePopover();
      findTime.close();
      if (args.id != null) state.selectedId = args.id;
      editor.open(args);
      views.renderAll();
    }

    function openFind(args) {
      closePopover();
      editor.close();
      closeDrawer();
      findTime.openFind(args || {});
    }

    // ---------- feedback after a change ----------
    function flash(id) {
      state.flash.add(id);
      setTimeout(() => {
        state.flash.delete(id);
        const ev = service.getEvent(id);
        if (ev) views.render([ev.day]);
      }, 1300);
    }

    function goTo(ev) {
      state.anchor = ev.day;
      if (state.view === "month") state.view = "week";
      views.renderAll();
      views.scrollToMinute(ev.start);
    }

    function afterChange(r, message, opts) {
      if (!r.ok) {
        announce((r.errors && r.errors[0] && r.errors[0].message) || "That change couldn't be made.");
        return;
      }
      flash(r.event.id);
      if (!views.visibleDays().includes(r.event.day) && state.view !== "month") goTo(r.event);
      toast(message, [{ label: "Undo", run: undo }]);
      if (r.conflicts && r.conflicts.length) requestAnimationFrame(() => requestAnimationFrame(() => showClash(r.conflicts[0], r.event.id)));
      if (opts && opts.keyboard) requestAnimationFrame(() => requestAnimationFrame(() => { const b = main.querySelector('.cl-event[data-id="' + r.event.id + '"]'); if (b) b.focus(); }));
    }

    function afterDelete(r) {
      if (!r.ok) return;
      state.selectedId = null;
      toast("Deleted " + r.event.title, [{ label: "Undo", run: undo }]);
      if (r.task) announce(r.task.name + " is back in Unplaced tasks.");
      main.focus();
    }

    function undo() {
      const r = service.undo();
      if (r.ok) { toast("Undone: " + r.label); views.renderAll(); }
    }

    // ---------- popovers ----------
    let popover = null;
    function closePopover() {
      if (popover) { popover.remove(); popover = null; }
    }

    // Clash pop-up: what overlaps, with Find another time / Keep both.
    function showClash(c, focusId) {
      closePopover();
      const a = service.getEvent(c.eventA), b = service.getEvent(c.eventB);
      if (!a || !b) return;
      const moving = focusId === a.id ? a : b;
      const other = moving === a ? b : a;
      const col = views.columnFor(a.day);
      if (!col) return;
      popover = el("div", { class: "cl-popover", role: "dialog", "aria-label": "Overlap", style: { top: Math.min(c.overlapEnd + 8, 1440 - 180) + "px", left: "4px" } },
        el("div", { class: "cl-popover__title cl-popover__title--conflict" }, icon("warn"), "Overlap · " + Time.duration(c.overlapMinutes)),
        el("p", { class: "cl-popover__body" }, moving.title + " overlaps " + other.title + " from " + Time.clock(c.overlapStart) + " to " + Time.clock(c.overlapEnd) + ". Both events are kept."),
        el("div", { class: "cl-popover__actions" },
          el("button", { class: "cl-btn cl-btn--ink", onclick: () => { closePopover(); state.selectedId = moving.id; editor.showFindAnother(moving.id); views.renderAll(); } }, "Find another time"),
          el("button", { class: "cl-btn cl-btn--secondary", onclick: () => { closePopover(); announce("Both events kept."); main.focus(); } }, "Keep both")));
      col.append(popover);
      popover.querySelector("button").focus();
    }

    // Quick add when an empty slot is clicked, with the time filled in.
    function quickAdd(day, minute, col) {
      closePopover();
      const start = minute, end = Math.min(1440, minute + 60);
      const input = el("input", { class: "quick__title", placeholder: "Event title", "aria-label": "Event title", autocomplete: "off" });
      const err = el("div", { class: "cl-error", role: "alert", hidden: true });
      const add = () => {
        const r = service.createEvent({ title: input.value, day, start, end, priority: "medium", category: "personal task" });
        if (!r.ok) { err.hidden = false; err.textContent = r.errors[0].message; input.setAttribute("aria-invalid", "true"); input.focus(); return; }
        closePopover();
        afterChange(r, "Event added");
      };
      popover = el("div", { class: "cl-popover", role: "dialog", "aria-label": "Quick add", style: { top: Math.min(start, 1440 - 170) + "px", left: "4px" } },
        el("div", { class: "cl-popover__title" }, Time.dayShort(day) + ", " + Time.range(start, end)), input, err,
        el("div", { class: "cl-popover__actions" },
          el("button", { class: "cl-btn cl-btn--primary", onclick: add }, "Add"),
          el("button", { class: "cl-btn cl-btn--secondary", onclick: () => { const t = input.value; closePopover(); openEditor({ draft: { day, start, end, title: t } }); } }, "More options")));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
      col.append(popover);
      input.focus();
    }

    window.Drag.attach({
      main, views, service, state,
      onOpen: (id) => openEditor({ id }),
      onEmpty: (day, minute, col) => quickAdd(day, minute, col),
      onDelete: (id) => openEditor({ id, confirmDelete: true }),
      onDone: (r, mode, opts) => {
        if (!r.ok) { views.renderAll(); return; }
        const msg = mode === "move" ? "Moved to " + Time.dayShort(r.event.day) + ", " + Time.range(r.event.start, r.event.end) : "Resized to " + Time.range(r.event.start, r.event.end);
        afterChange(r, msg, opts);
      }
    });
    main.addEventListener("click", (e) => { if (popover && !popover.contains(e.target) && !e.target.closest(".cl-overlap__label") && !e.target.classList.contains("cl-col")) closePopover(); });

    // ---------- toolbar ----------
    function renderTitle() {
      const ref = state.view === "week" ? Time.weekStart(state.anchor) : state.anchor;
      const t = Time.monthTitle(state.view === "week" ? Time.addDays(ref, 3) : ref);
      const h = $("title");
      h.replaceChildren(t.month + " ", el("span", { class: "bar__year" }, t.year));
      document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === state.view)));
      document.title = t.month + " " + t.year + " · Smart Scheduler";
    }

    function setView(v) {
      state.view = v;
      closePopover();
      views.renderAll();
      if (v !== "month") views.scrollToMinute(8 * 60);
    }

    function step(dir) {
      closePopover();
      if (state.view === "day") state.anchor = Time.addDays(state.anchor, dir);
      else if (state.view === "week") state.anchor = Time.addDays(state.anchor, 7 * dir);
      else {
        const p = Time.parts(state.anchor);
        const m = p.mo - 1 + dir;
        const y = p.y + Math.floor(m / 12), mo = ((m % 12) + 12) % 12 + 1;
        state.anchor = y + "-" + String(mo).padStart(2, "0") + "-01";
      }
      state.miniMonth = state.anchor.slice(0, 8) + "01";
      views.renderAll();
      announce("Showing " + $("title").textContent);
    }

    function goToday() {
      state.anchor = Time.today();
      state.miniMonth = state.anchor.slice(0, 8) + "01";
      views.renderAll();
      if (state.view !== "month") views.scrollToMinute(Math.max(0, Time.nowMinute() - 120));
    }

    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
    $("prev").addEventListener("click", () => step(-1));
    $("next").addEventListener("click", () => step(1));
    $("today").addEventListener("click", goToday);
    const newEvent = () => {
      const start = Math.min(23 * 60, (Math.floor(Time.nowMinute() / 60) + 1) * 60);
      openEditor({ draft: { day: state.anchor, start, end: start + 60 } });
    };
    $("add-top").addEventListener("click", newEvent);
    $("fab").addEventListener("click", newEvent);

    // ---------- search ----------
    const searchInput = $("search"), searchResults = $("search-results");
    function runSearch() {
      const q = searchInput.value;
      const found = service.search(q);
      state.matchIds = q.trim() ? new Set(found.map((e) => e.id)) : null;
      searchResults.replaceChildren();
      searchResults.hidden = !q.trim();
      if (q.trim() && !found.length) searchResults.append(el("div", { class: "search__empty" }, "No events match “" + q.trim() + "”"));
      for (const ev of found.slice(0, 8)) {
        searchResults.append(el("button", { onclick: () => { searchResults.hidden = true; state.selectedId = ev.id; flash(ev.id); goTo(ev); } },
          ev.title, el("small", {}, Time.dayLabel(ev.day) + ", " + Time.range(ev.start, ev.end))));
      }
      views.renderAll();
    }
    searchInput.addEventListener("input", runSearch);
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Escape") { searchInput.value = ""; runSearch(); searchInput.blur(); } });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search")) searchResults.hidden = true; });

    // ---------- sidebar ----------
    function renderMini() {
      const box = $("mini");
      const first = state.miniMonth;
      const t = Time.monthTitle(first);
      const start = Time.weekStart(first);
      const weekOfAnchor = Time.weekStart(state.anchor);
      const grid = el("div", { class: "cl-mini", role: "grid", "aria-label": t.month + " " + t.year });
      for (const d of ["M", "T", "W", "T", "F", "S", "S"]) grid.append(el("span", { class: "cl-mini__dow", "aria-hidden": "true" }, d));
      for (let i = 0; i < 42; i++) {
        const d = Time.addDays(start, i);
        if (i === 35 && Time.parts(d).mo !== Time.parts(first).mo) break;
        const b = el("button", { class: "cl-mini__day" + (Time.parts(d).mo !== Time.parts(first).mo ? " is-out" : ""), "aria-label": Time.dayLabel(d), onclick: () => { state.anchor = d; views.renderAll(); } }, Time.parts(d).d);
        if (d === Time.today()) b.setAttribute("aria-current", "date");
        const inWeek = state.view === "week" && Time.weekStart(d) === weekOfAnchor;
        grid.append(el("div", { class: "mini__cell" + (inWeek || (state.view === "day" && d === state.anchor) ? " is-week" : "") }, b));
      }
      const moveMonth = (n) => {
        const p = Time.parts(first);
        const m = p.mo - 1 + n;
        state.miniMonth = p.y + Math.floor(m / 12) + "-" + String(((m % 12) + 12) % 12 + 1).padStart(2, "0") + "-01";
        renderMini();
      };
      box.replaceChildren(el("div", { class: "mini__head" }, el("span", {}, t.month + " " + t.year),
        el("span", {}, el("button", { class: "cl-btn cl-btn--ghost cl-btn--icon", "aria-label": "Previous month", onclick: () => moveMonth(-1) }, icon("left")),
          el("button", { class: "cl-btn cl-btn--ghost cl-btn--icon", "aria-label": "Next month", onclick: () => moveMonth(1) }, icon("right")))), grid);
    }

    function renderCalendars() {
      const box = $("cals");
      box.replaceChildren();
      for (const [key, label] of Object.entries(CATEGORIES)) {
        const cb = el("input", { type: "checkbox", style: { accentColor: "var(--cat-" + catCss(key) + "-dot)" } });
        cb.checked = !state.hidden.has(key);
        cb.addEventListener("change", () => { if (cb.checked) state.hidden.delete(key); else state.hidden.add(key); views.renderAll(); });
        box.append(el("label", { class: "cal" }, cb, el("span", {}, label)));
      }
    }

    function renderTasks() {
      const box = $("tasks");
      const tasks = service.unplacedTasks();
      box.replaceChildren();
      if (!tasks.length) box.append(el("p", { class: "muted" }, "No unplaced tasks."));
      for (const t of tasks) {
        const due = t.deadline ? "due " + Time.dayShort(t.deadline.day) + ", " + Time.clock(Math.min(t.deadline.minute, 1439)) : "no deadline";
        box.append(el("div", { class: "task" },
          el("div", { class: "task__head" }, el("span", {}, t.name), el("span", { class: "task__pri" + (t.priority === "high" ? " task__pri--high" : "") }, t.priority[0].toUpperCase() + t.priority.slice(1))),
          el("div", { class: "task__meta" }, Time.duration(t.duration) + " · " + due),
          el("div", { class: "task__actions" },
            el("button", { class: "link", onclick: () => openFind({ taskId: t.id }) }, "Find a time"),
            el("span", { class: "spacer", style: { flex: 1 } }),
            el("button", { class: "link link--muted", "aria-label": "Delete task " + t.name, onclick: () => { service.deleteTask(t.id); toast("Deleted task " + t.name); } }, "Delete"))));
      }
    }

    $("new-task").addEventListener("click", () => { editor.close(); closeDrawer(); findTime.openNewTask(); });
    $("export").addEventListener("click", () => download("smart-scheduler-" + Time.today() + ".json", service.exportCalendar()));
    $("import").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const r = service.importCalendar(String(reader.result));
        if (r.ok) toast("Calendar imported");
        else showBanner("warn", "That file couldn't be imported. " + r.error.message, []);
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    $("demo").addEventListener("click", () => {
      if (service.store.allEvents().length && !window.confirm("Replace your calendar with the demo calendar?")) return;
      service.loadData(window.DEMO_CALENDAR);
      state.anchor = window.DEMO_CALENDAR.focusDay || state.anchor;
      state.miniMonth = state.anchor.slice(0, 8) + "01";
      views.renderAll();
      views.scrollToMinute(8 * 60);
      toast("Demo calendar loaded", [{ label: "Undo", run: () => { service.loadData({ events: [], tasks: [] }); views.renderAll(); } }]);
    });

    // Drawer for tablets and phones.
    function openDrawer() { side.classList.add("is-open"); scrim.classList.add("is-open"); $("menu").setAttribute("aria-expanded", "true"); side.querySelector("button").focus(); }
    function closeDrawer() { side.classList.remove("is-open"); scrim.classList.remove("is-open"); $("menu").setAttribute("aria-expanded", "false"); }
    $("menu").addEventListener("click", () => (side.classList.contains("is-open") ? closeDrawer() : openDrawer()));
    scrim.addEventListener("click", closeDrawer);
    $("tab-tasks").addEventListener("click", openDrawer);

    // ---------- banners: saving and loading ----------
    function showBanner(kind, text, actions, id) {
      const box = $("banners");
      if (id) { const old = document.getElementById(id); if (old) old.remove(); }
      const b = el("div", { class: "banner banner--" + (kind === "danger" ? "danger" : "warn"), role: kind === "danger" ? "alert" : "status", id: id || null },
        el("span", { class: "banner__text" }, text));
      for (const a of actions) b.append(el("button", { class: "cl-btn cl-btn--secondary", onclick: a.run }, a.label));
      b.append(el("button", { class: "cl-btn cl-btn--ghost cl-btn--icon", "aria-label": "Dismiss", onclick: () => b.remove() }, icon("close")));
      box.append(b);
    }

    onSaveError = (err) => {
      showBanner("danger", "Couldn't save. " + err.message, [
        { label: "Try again", run: () => { const r = service.saveNow(); if (r.ok) { const b = $("save-banner"); if (b) b.remove(); toast("Saved"); } } },
        { label: "Export events", run: () => download("smart-scheduler-" + Time.today() + ".json", service.exportCalendar()) }
      ], "save-banner");
    };
    onSaved = () => { const b = $("save-banner"); if (b) b.remove(); };

    // ---------- keyboard shortcuts ----------
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (popover) { closePopover(); main.focus(); return; }
        if (side.classList.contains("is-open")) { closeDrawer(); return; }
        if (!panel.hidden) { closePanels(); state.selectedId = null; views.renderAll(); main.focus(); return; }
        return;
      }
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const onEvent = e.target.closest && e.target.closest(".cl-event");
      switch (e.key) {
        case "n": case "N": e.preventDefault(); newEvent(); break;
        case "t": case "T": goToday(); break;
        case "d": case "D": setView("day"); break;
        case "w": case "W": setView("week"); break;
        case "m": case "M": setView("month"); break;
        case "f": case "F": { e.preventDefault(); const first = service.unplacedTasks()[0]; openFind(first ? { taskId: first.id } : {}); break; }
        case "/": e.preventDefault(); searchInput.focus(); break;
        case "ArrowLeft": if (!onEvent && !e.target.closest(".cl-mini, .chips, .cl-seg")) step(-1); break;
        case "ArrowRight": if (!onEvent && !e.target.closest(".cl-mini, .chips, .cl-seg")) step(1); break;
        case "Delete": case "Backspace": if (!onEvent && state.selectedId != null) openEditor({ id: state.selectedId, confirmDelete: true }); break;
        default:
      }
    });

    // ---------- screen size ----------
    let lastDays = state.weekDays;
    window.addEventListener("resize", () => {
      const w = window.innerWidth;
      state.weekDays = w < 1200 && w >= 768 ? 5 : 7;
      if (w >= 1200) closeDrawer();
      if (state.weekDays !== lastDays) { lastDays = state.weekDays; views.renderAll(); }
    });

    // Keep the now line moving.
    setInterval(() => views.render([Time.today()]), 60000);

    // ---------- start ----------
    renderCalendars();
    const loaded = app.start(); // loads the saved calendar and checks every day for clashes
    if (loaded.warning) showBanner("warn", loaded.warning + (loaded.status === "unavailable" ? " Use Export to keep them." : ""), []);
    views.renderAll();
    views.scrollToMinute(8 * 60);

    // For the browser checks in tests/browser.
    Screens.current = { service, state, views };
    return loaded;
  }

  const Screens = {
    start,
    current: null,
    render: (days, info) => { if (onRender) onRender(days, info); },
    saved: () => { if (onSaved) onSaved(); },
    saveFailed: (err) => { if (onSaveError) onSaveError(err); }
  };
  window.Screens = Screens;
})();
