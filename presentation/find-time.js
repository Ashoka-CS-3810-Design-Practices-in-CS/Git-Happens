// Owner: Yashita (presentation layer)
// "New task" form and the "Find a time" screen: the form, ER3 and ER4 messages with one-tap
// fixes, and three slot cards with score, four score bars, the reason and Add to calendar.
(function () {
  "use strict";

  const { el, icon } = window.UI;
  const Time = window.Time;

  const DURATIONS = [30, 60, 90, 120];

  function durationPicker(value, onChange) {
    const wrap = el("div", { class: "chips", role: "group", "aria-label": "Duration" });
    const custom = el("input", { type: "number", min: 5, step: 5, "aria-label": "Custom duration in minutes", style: { width: "96px" }, hidden: DURATIONS.includes(value) });
    custom.value = value;
    const chips = [];
    const pick = (v, isCustom) => {
      chips.forEach((c) => c.setAttribute("aria-pressed", String(isCustom ? c.dataset.custom === "1" : Number(c.dataset.v) === v)));
      custom.hidden = !isCustom;
      if (isCustom) custom.focus();
      onChange(isCustom ? Number(custom.value) : v);
    };
    for (const d of DURATIONS) {
      const c = el("button", { type: "button", class: "cl-chip", "aria-pressed": String(d === value), "data-v": d }, Time.duration(d));
      c.addEventListener("click", () => pick(d, false));
      chips.push(c); wrap.append(c);
    }
    const c = el("button", { type: "button", class: "cl-chip", "aria-pressed": String(!DURATIONS.includes(value)), "data-custom": "1" }, "Custom");
    c.addEventListener("click", () => pick(Number(custom.value), true));
    chips.push(c);
    custom.addEventListener("input", () => onChange(Number(custom.value)));
    wrap.append(c, custom);
    return el("div", { class: "field" }, el("span", { class: "cl-field-label" }, "Duration"), wrap);
  }

  function priorityPicker(value, onChange) {
    const seg = el("div", { class: "cl-seg cl-seg--fill", role: "radiogroup", "aria-label": "Priority" });
    for (const p of ["low", "medium", "high"]) {
      const b = el("button", { type: "button", class: "cl-seg__item", role: "radio", "aria-checked": String(p === value) }, p[0].toUpperCase() + p.slice(1));
      b.addEventListener("click", () => { seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b))); onChange(p); });
      seg.append(b);
    }
    return el("div", { class: "field" }, el("span", { class: "cl-field-label" }, "Priority"), seg);
  }

  function labelled(label, input, id) {
    input.id = id;
    const err = el("div", { class: "cl-error", id: id + "-err", role: "alert", hidden: true });
    input.setAttribute("aria-describedby", id + "-err");
    return { wrap: el("div", { class: "field" }, el("label", { class: "cl-field-label", for: id }, label), input, err), input, err };
  }

  function showFieldErrors(fields, errors) {
    for (const [name, f] of Object.entries(fields)) {
      const e = errors.find((x) => x.field === name);
      f.input.setAttribute("aria-invalid", e ? "true" : "false");
      f.err.hidden = !e;
      f.err.textContent = e ? e.message : "";
    }
  }

  function header(title, onClose) {
    return el("div", { class: "panel__head" }, el("h2", { class: "t-panel-title", id: "panel-title" }, title),
      el("button", { type: "button", class: "cl-btn cl-btn--ghost cl-btn--icon", "aria-label": "Close", onclick: onClose }, icon("close")));
  }

  function create(opts) {
    const { panel, service, state, onCreatedTask, onSearched, onAccepted, onClose } = opts;
    let mode = null;
    let redraw = null; // redraws the open Find a time cards

    function close() {
      mode = null;
      redraw = null;
      service.closeSearch();
      state.chosenRank = 1;
      panel.hidden = true;
      panel.replaceChildren();
    }
    const closeAndNotify = () => { close(); onClose(); };

    // ---------------- New task ----------------
    function openNewTask() {
      mode = "task";
      const f = { name: "", duration: 60, priority: "medium" };
      const name = labelled("Task name", el("input", { class: "cl-input cl-input--text", placeholder: "e.g. Write viva notes", autocomplete: "off" }), "tk-name");
      const dDay = labelled("Deadline date (optional)", el("input", { type: "date" }), "tk-dday");
      const dTime = labelled("Deadline time", el("input", { type: "time", step: 900, value: "17:00" }), "tk-dtime");
      const durationErr = { input: el("span"), err: el("div", { class: "cl-error", role: "alert", hidden: true }) };

      const form = el("form", { novalidate: true },
        el("div", { class: "panel__body" }, name.wrap, durationPicker(f.duration, (v) => { f.duration = v; }), durationErr.err,
          priorityPicker(f.priority, (v) => { f.priority = v; }), el("div", { class: "field-row" }, dDay.wrap, dTime.wrap),
          el("p", { class: "muted" }, "The task goes in Unplaced tasks. Use Find a time to place it.")),
        el("div", { class: "panel__foot" }, el("span", { class: "spacer" }),
          el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: closeAndNotify }, "Cancel"),
          el("button", { type: "submit", class: "cl-btn cl-btn--primary" }, "Add task")));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const deadline = dDay.input.value ? { day: dDay.input.value, minute: dTime.input.value } : null;
        const r = service.createTask({ name: name.input.value, duration: f.duration, priority: f.priority, deadline });
        if (!r.ok) { showFieldErrors({ name, deadline: dDay, duration: durationErr }, r.errors); return; }
        close();
        onCreatedTask(r.task);
      });
      panel.replaceChildren(header("New task", closeAndNotify), form);
      panel.hidden = false;
      name.input.focus();
    }

    // ---------------- Find a time ----------------
    function openFind(args) {
      mode = "find";
      const task = args && args.taskId != null ? service.getTask(args.taskId) : null;
      const f = {
        taskId: task ? task.id : null,
        name: task ? task.name : (args && args.name) || "",
        duration: task ? task.duration : 60,
        priority: task ? task.priority : (args && args.priority) || "medium",
        deadline: task ? task.deadline : null,
        window: { day: (args && args.day) || state.anchor, start: 9 * 60, end: 18 * 60 }
      };
      if (args && args.window) Object.assign(f.window, args.window);
      if (args && args.duration) f.duration = args.duration;

      const name = labelled("Task", el("input", { class: "cl-input cl-input--text", value: f.name, placeholder: "Task name", readonly: !!task, autocomplete: "off" }), "ft-name");
      const day = labelled("Day", el("input", { type: "date", value: f.window.day }), "ft-day");
      const ws = labelled("From", el("input", { type: "time", step: 900, value: Time.clock(f.window.start) }), "ft-start");
      const we = labelled("To", el("input", { type: "time", step: 900, value: Time.clock(Math.min(f.window.end, 1439)) }), "ft-end");
      const dDay = labelled("Deadline (optional)", el("input", { type: "date", value: f.deadline ? f.deadline.day : "" }), "ft-dday");
      const dTime = labelled("Deadline time", el("input", { type: "time", step: 900, value: f.deadline ? Time.clock(Math.min(f.deadline.minute, 1439)) : "17:00" }), "ft-dtime");
      const results = el("div", { class: "recs", "aria-live": "polite" });

      const readForm = () => {
        f.name = name.input.value;
        f.window = { day: day.input.value, start: ws.input.value, end: we.input.value };
        f.deadline = dDay.input.value ? { day: dDay.input.value, minute: dTime.input.value } : null;
        return f;
      };

      function run() {
        const form = readForm();
        const r = service.findTimes(form);
        if (r.taskId != null) f.taskId = r.taskId; // the task is saved (or updated) before the search
        showFieldErrors({ name, window: we, deadline: dDay }, r.ok ? [] : (r.errors || []).filter((e) => e.code !== "ER3" && e.code !== "ER4"));
        state.chosenRank = 1;
        drawResults(r);
        onSearched(r, service.currentSearch());
      }

      function rerun(changes) {
        if (changes.duration) { f.duration = changes.duration; panel.replaceChildren(); const w = readForm().window; openFind({ taskId: f.taskId, name: f.name, priority: f.priority, day: w.day, window: { start: Time.parseClock(w.start), end: Time.parseClock(w.end) }, duration: f.duration }); panel.querySelector("form").requestSubmit(); return; }
        if (changes.window) { ws.input.value = Time.clock(changes.window.start); we.input.value = Time.clock(Math.min(changes.window.end, 1439)); }
        if (changes.day) day.input.value = changes.day;
        run();
      }

      function drawResults(r) {
        results.replaceChildren();
        const w = service.currentSearch() ? service.currentSearch().window : null;
        if (!r.ok) {
          const e = r.error;
          if (e.code === "ER3") {
            const start = Time.parseClock(ws.input.value);
            const fixes = el("div", { class: "callout__actions" });
            if (start != null && start + f.duration <= 1440)
              fixes.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => rerun({ window: { start, end: start + f.duration } }) }, "Use " + Time.range(start, start + f.duration)));
            if (e.data && e.data.windowMinutes >= 15)
              fixes.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => rerun({ duration: e.data.windowMinutes }) }, "Make it " + Time.duration(e.data.windowMinutes)));
            results.append(el("div", { class: "cl-callout cl-callout--danger", role: "alert" }, el("strong", {}, "Window too short"), el("div", {}, e.message), fixes));
          } else if (e.code === "ER4") {
            const gap = e.data && e.data.longestGap;
            const actions = el("div", { class: "cl-empty__actions" });
            if (w && (w.start > 480 || w.end < 1200))
              actions.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => rerun({ window: { start: Math.min(w.start, 480), end: Math.max(w.end, 1200) } }) }, "Widen to " + Time.range(Math.min(w.start, 480), Math.max(w.end, 1200))));
            if (gap && gap.end - gap.start >= 15)
              actions.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => rerun({ duration: Math.floor((gap.end - gap.start) / 5) * 5 }) }, "Make it " + Time.duration(Math.floor((gap.end - gap.start) / 5) * 5)));
            if (w) actions.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => rerun({ day: Time.addDays(w.day, 1) }) }, "Try " + Time.dayShort(Time.addDays(w.day, 1))));
            results.append(el("div", { class: "cl-empty", role: "alert" }, el("p", { class: "cl-empty__title" }, e.message),
              el("p", { class: "cl-empty__body" }, gap ? "The closest miss is " + Time.duration(gap.end - gap.start) + " free, " + Time.range(gap.start, gap.end) + "." : "The whole window is booked."),
              actions));
          } else if (r.errors && r.errors.length) {
            results.append(el("p", { class: "muted" }, "Fix the marked fields, then press Find times."));
          }
          return;
        }
        results.append(el("p", { class: "muted" }, "Best " + r.recommendations.length + " on " + Time.dayLabel(w.day) + ". Pick one, then Add to calendar."));
        for (const rec of r.recommendations) results.append(card(rec));
      }

      function bar(label, v) {
        return el("div", { class: "cl-bar" }, el("div", { class: "cl-bar__label" }, el("span", {}, label), el("b", {}, v.toFixed(2))),
          el("div", { class: "cl-bar__track" }, el("div", { class: "cl-bar__fill", style: { width: Math.round(v * 100) + "%" } })));
      }

      function card(rec) {
        const chosen = state.chosenRank === rec.rank;
        const b = rec.scoreBreakdown;
        const node = el("div", { class: "cl-rec" + (chosen ? " is-chosen" : ""), role: "radio", tabindex: 0, "aria-checked": String(chosen),
          "aria-label": "Option " + rec.rank + ", " + Time.range(rec.slot.start, rec.slot.end) + ", score " + rec.scoreTotal.toFixed(2) + ". " + rec.reason },
        el("div", { class: "cl-rec__head" }, el("span", { class: "cl-rank" + (rec.rank === 1 ? "" : " cl-rank--outline") }, rec.rank),
          el("span", { class: "cl-rec__time" }, Time.dayShort(rec.slot.day) + ", " + Time.range(rec.slot.start, rec.slot.end)),
          el("span", { class: "cl-rec__score" }, rec.scoreTotal.toFixed(2))),
        el("p", { class: "cl-rec__why" }, rec.reason),
        el("div", { class: "cl-bars" }, bar("Earliness", b.earliness), bar("Fit tightness", b.fitTightness), bar("Deadline urgency", b.deadlineUrgency), bar("Working hours", b.workingHours)));
        if (chosen) {
          const add = el("button", { type: "button", class: "cl-btn cl-btn--primary" }, "Add to calendar");
          add.addEventListener("click", (e) => { e.stopPropagation(); accept(rec); });
          node.append(add);
        }
        const choose = () => { state.chosenRank = rec.rank; redraw(); };
        node.addEventListener("click", choose);
        node.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(); } });
        return node;
      }

      function accept(rec) {
        const r = service.acceptSlot(f.taskId, rec);
        if (!r.ok) return;
        close();
        onAccepted(r);
      }

      redraw = () => { const s = service.currentSearch(); if (s) { drawResults(s.result); onSearched(s.result, s); } };

      const form = el("form", { novalidate: true },
        el("div", { class: "panel__body" }, name.wrap, durationPicker(f.duration, (v) => { f.duration = v; }), priorityPicker(f.priority, (v) => { f.priority = v; }),
          day.wrap, el("div", { class: "field-row" }, ws.wrap, we.wrap), el("div", { class: "field-row" }, dDay.wrap, dTime.wrap),
          el("button", { type: "submit", class: "cl-btn cl-btn--ink cl-btn--lg" }, "Find times"), results));
      form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
      panel.replaceChildren(header("Find a time", closeAndNotify), form);
      panel.hidden = false;
      (task ? form.querySelector("button[type=submit]") : name.input).focus();
    }

    // Lets the grid's ghost slots pick a card.
    function choose(rank) {
      if (mode !== "find" || !redraw) return;
      state.chosenRank = rank;
      redraw();
    }

    // Redraws the cards when a change elsewhere refreshed the open search.
    function refresh() {
      if (mode === "find" && redraw) redraw();
    }

    return { openNewTask, openFind, close, mode: () => mode, choose, refresh };
  }

  window.FindTime = { create };
})();
