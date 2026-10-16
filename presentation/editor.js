// Owner: Yashita (presentation layer)
// Right-hand event editor: all fields, category chips, priority, notes, the clash box with
// Move buttons, and Delete with a one-step inline confirmation.
(function () {
  "use strict";

  const { el, icon, CATEGORIES, catCss } = window.UI;
  const Time = window.Time;

  function create(opts) {
    const { panel, service, onSaved, onDeleted, onClose, onMoved } = opts;
    let current = null; // { id | null, category, priority }

    function field(label, input, id) {
      const err = el("div", { class: "cl-error", id: id + "-err", role: "alert", hidden: true });
      input.id = id;
      input.setAttribute("aria-describedby", id + "-err");
      return { wrap: el("div", { class: "field" }, el("label", { class: "cl-field-label", for: id }, label), input, err), input, err };
    }

    function chipGroup(label, options, value, onPick, cats) {
      const group = el("div", { class: "chips", role: "group", "aria-label": label });
      for (const [key, text] of options) {
        const chip = el("button", { type: "button", class: "cl-chip", "aria-pressed": String(key === value), "data-cat": cats ? catCss(key) : null },
          cats ? el("span", { class: "cl-chip__dot" }) : null, text);
        chip.addEventListener("click", () => {
          group.querySelectorAll(".cl-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
          onPick(key);
        });
        group.append(chip);
      }
      return el("div", { class: "field" }, el("span", { class: "cl-field-label" }, label), group);
    }

    function open(args) {
      const ev = args.id != null ? service.getEvent(args.id) : null;
      const draft = ev || Object.assign({ title: "", description: "", category: "personal task", priority: "medium" }, args.draft);
      current = { id: ev ? ev.id : null, category: draft.category, priority: draft.priority, touched: new Set() };

      const title = field("Title", el("input", { class: "cl-input cl-input--text", value: draft.title, placeholder: "Event title", autocomplete: "off" }), "ed-title");
      const date = field("Date", el("input", { type: "date", value: draft.day }), "ed-day");
      const start = field("Start", el("input", { type: "time", step: 900, value: Time.clock(draft.start) }), "ed-start");
      const end = field("End", el("input", { type: "time", step: 900, value: Time.clock(Math.min(draft.end, 1439)) }), "ed-end");
      if (draft.end === 1440) end.input.value = "23:59";
      const notes = field("Notes", el("textarea", {}, draft.description || ""), "ed-notes");
      const fields = { title, day: date, start, end };

      const save = el("button", { type: "submit", class: "cl-btn cl-btn--primary" }, "Save");
      const read = () => ({
        title: title.input.value, day: date.input.value,
        start: start.input.value, end: end.input.value === "23:59" ? "24:00" : end.input.value,
        category: current.category, priority: current.priority, description: notes.input.value
      });

      // Errors show as you type for the times; the title waits until you leave it or press Save.
      function check(all) {
        if (!current) return { ok: false };
        const v = service.validateEvent(read());
        for (const [name, f] of Object.entries(fields)) {
          const err = v.ok ? null : v.errors.find((x) => x.field === name);
          const show = err && (all || name !== "title" || current.touched.has("title"));
          f.input.setAttribute("aria-invalid", show ? "true" : "false");
          f.err.hidden = !show;
          f.err.textContent = show ? err.message : "";
        }
        save.disabled = !v.ok;
        return v;
      }
      for (const f of Object.values(fields)) f.input.addEventListener("input", () => check(false));
      title.input.addEventListener("blur", () => { if (!current) return; current.touched.add("title"); check(false); });

      const form = el("form", { class: "panel__form", novalidate: true });
      const body = el("div", { class: "panel__body" },
        title.wrap, date.wrap, el("div", { class: "field-row" }, start.wrap, end.wrap),
        chipGroup("Category", Object.entries(CATEGORIES), current.category, (k) => { current.category = k; }, true),
        el("div", { class: "field" }, el("span", { class: "cl-field-label", id: "ed-pri-l" }, "Priority"), priorityControl()),
        notes.wrap);

      if (ev) {
        const clashes = service.conflictsFor(ev.id);
        if (clashes.length) body.append(clashBox(ev, clashes));
      }

      const foot = el("div", { class: "panel__foot" });
      if (ev) {
        const del = el("button", { type: "button", class: "cl-btn cl-btn--danger-text" }, "Delete");
        del.addEventListener("click", () => {
          const confirm = el("div", { class: "confirm", role: "alertdialog", "aria-label": "Confirm delete" },
            el("span", {}, "Delete ‘" + ev.title + "’?"),
            el("button", { type: "button", class: "cl-btn cl-btn--danger", onclick: () => { const r = service.deleteEvent(ev.id); close(); onDeleted(r); } }, "Delete"),
            el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => { confirm.replaceWith(del); del.focus(); } }, "Cancel"));
          del.replaceWith(confirm);
          confirm.querySelector(".cl-btn--danger").focus();
        });
        foot.append(del);
        if (args.confirmDelete) setTimeout(() => del.click(), 0);
      }
      foot.append(el("span", { class: "spacer" }),
        el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => { close(); onClose(); } }, "Cancel"), save);

      form.append(body, foot);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        current.touched.add("title");
        const v = check(true);
        if (!v.ok) { const bad = Object.values(fields).find((f) => f.input.getAttribute("aria-invalid") === "true"); if (bad) bad.input.focus(); return; }
        const result = current.id == null ? service.createEvent(read()) : service.updateEvent(current.id, read(), { label: "Event changed" });
        if (!result.ok) { check(true); return; }
        const isNew = current.id == null;
        close();
        onSaved(result, isNew);
      });

      panel.replaceChildren(
        el("div", { class: "panel__head" }, el("h2", { class: "t-panel-title", id: "panel-title" }, ev ? "Edit event" : "New event"),
          el("button", { type: "button", class: "cl-btn cl-btn--ghost cl-btn--icon", "aria-label": "Close", onclick: () => { close(); onClose(); } }, icon("close"))),
        form);
      panel.hidden = false;
      panel.setAttribute("aria-labelledby", "panel-title");
      check(false);
      title.input.focus();

      function priorityControl() {
        const seg = el("div", { class: "cl-seg cl-seg--fill", role: "radiogroup", "aria-labelledby": "ed-pri-l" });
        for (const p of ["low", "medium", "high"]) {
          const b = el("button", { type: "button", class: "cl-seg__item", role: "radio", "aria-checked": String(p === current.priority) }, p[0].toUpperCase() + p.slice(1));
          b.addEventListener("click", () => {
            current.priority = p;
            seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
          });
          seg.append(b);
        }
        return seg;
      }
    }

    // The editor's clash box: what overlaps, then Move buttons from the best-time finder.
    function clashBox(ev, clashes) {
      const box = el("div", { class: "cl-callout cl-callout--conflict", role: "group", "aria-label": "Overlap" });
      for (const c of clashes) {
        const other = service.getEvent(c.eventA === ev.id ? c.eventB : c.eventA);
        box.append(el("div", { class: "cl-popover__title" }, icon("warn"), "Overlap · " + Time.duration(c.overlapMinutes)),
          el("div", {}, ev.title + " overlaps " + other.title + " from " + Time.clock(c.overlapStart) + " to " + Time.clock(c.overlapEnd) + ". Both events are kept."));
      }
      const actions = el("div", { class: "callout__actions" });
      const find = el("button", { type: "button", class: "cl-btn cl-btn--ink" }, "Find another time");
      find.addEventListener("click", () => {
        const r = service.findAnotherTime(ev.id);
        actions.replaceChildren();
        if (!r.ok) { actions.append(el("span", {}, r.error.message)); return; }
        for (const rec of r.recommendations) {
          actions.append(el("button", { type: "button", class: "cl-btn cl-btn--secondary", onclick: () => { const res = service.moveToSlot(ev.id, rec.slot); close(); onMoved(res); } },
            "Move to " + Time.range(rec.slot.start, rec.slot.end)));
        }
      });
      actions.append(find);
      box.append(actions);
      return box;
    }

    function close() {
      current = null;
      panel.hidden = true;
      panel.replaceChildren();
    }

    return { open, close, isOpen: () => current !== null, showFindAnother: (id) => { open({ id }); const b = [...panel.querySelectorAll("button")].find((x) => x.textContent === "Find another time"); if (b) b.click(); } };
  }

  window.Editor = { create };
})();
