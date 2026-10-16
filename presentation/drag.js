// Owner: Yashita (presentation layer)
// Drag to move, drag the bottom edge to resize. Pointer Events, so mouse, pen and touch all work.
// While dragging only the moved event is checked against its day (quick check, O(n_d));
// the full pipeline runs once, on drop. Keyboard: Alt+arrows move, Alt+Shift+Up/Down resize.
(function () {
  "use strict";

  const { el } = window.UI;
  const Time = window.Time;
  const THRESHOLD = 4; // px before a press counts as a drag

  function attach(opts) {
    const { main, views, service, state, onOpen, onEmpty, onDone, onDelete } = opts;
    let drag = null;

    function showHint(col, top, text) {
      let hint = drag.hint;
      if (!hint) hint = drag.hint = el("div", { class: "drag-hint", role: "status" });
      hint.textContent = text;
      hint.style.top = top + 4 + "px";
      if (hint.parentNode !== col) col.append(hint);
    }

    function onPointerDown(e) {
      const block = e.target.closest(".cl-event");
      if (!block || e.button !== 0 || state.view === "month") return;
      const ev = service.getEvent(block.dataset.id);
      if (!ev) return;
      drag = {
        ev, block, pointerId: e.pointerId, x: e.clientX, y: e.clientY, moved: false,
        mode: e.target.closest("[data-resize]") ? "resize-end" : "move",
        next: { day: ev.day, start: ev.start, end: ev.end }, hint: null
      };
      main.setPointerCapture(e.pointerId); // on main, so moving the block between columns keeps the capture
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;
      drag.moved = true;
      drag.block.classList.add("is-dragging");
      const ev = drag.ev;
      let next, clamped = false;
      if (drag.mode === "move") {
        const c = service.clampDrag(ev.start + dy, ev.end + dy);
        const hit = state.view === "week" ? views.hit(e.clientX, e.clientY) : null;
        next = { day: hit ? hit.day : ev.day, start: c.start, end: c.end };
      } else {
        const c = service.clampDrag(ev.start, ev.end + dy);
        next = { day: ev.day, start: c.start, end: c.end };
        clamped = c.clamped;
      }
      drag.next = next;
      const col = views.columnFor(next.day);
      if (col && drag.block.parentNode !== col) col.append(drag.block);
      drag.block.style.top = next.start + 1 + "px";
      drag.block.style.height = next.end - next.start - 2 + "px";
      if (drag.mode === "move") { drag.block.style.left = "3px"; drag.block.style.width = "calc(100% - 6px)"; }
      // Quick check against the day only; the striped bands wait for the drop.
      const clashes = service.quickCheck(Object.assign({}, ev, next));
      drag.block.classList.toggle("is-conflict", clashes.length > 0);
      if (col) showHint(col, next.end, clamped ? "Minimum 15 min" : Time.range(next.start, next.end));
    }

    function onPointerUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag;
      drag = null;
      if (d.hint) d.hint.remove();
      if (!d.moved) { onOpen(d.ev.id); return; }
      const n = d.next;
      if (n.day === d.ev.day && n.start === d.ev.start && n.end === d.ev.end) { views.render([d.ev.day]); return; }
      const result = service.updateEvent(d.ev.id, n, { source: "drag", mode: d.mode, label: d.mode === "move" ? "Moved" : "Resized" });
      onDone(result, d.mode);
    }

    function onPointerCancel() {
      if (!drag) return;
      const day = drag.ev.day;
      if (drag.hint) drag.hint.remove();
      drag = null;
      views.render([day]);
    }

    // Keyboard on a focused event.
    function onKeyDown(e) {
      const block = e.target.closest && e.target.closest(".cl-event");
      if (!block) return;
      const ev = service.getEvent(block.dataset.id);
      if (!ev) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); onDelete(ev.id); return; }
      if (!e.altKey) return;
      let changes = null, mode = "move";
      if (e.shiftKey && e.key === "ArrowUp") { changes = { end: ev.end - 15 }; mode = "resize-end"; }
      else if (e.shiftKey && e.key === "ArrowDown") { changes = { end: ev.end + 15 }; mode = "resize-end"; }
      else if (e.key === "ArrowUp") changes = { start: ev.start - 15, end: ev.end - 15 };
      else if (e.key === "ArrowDown") changes = { start: ev.start + 15, end: ev.end + 15 };
      else if (e.key === "ArrowLeft") changes = { day: Time.addDays(ev.day, -1) };
      else if (e.key === "ArrowRight") changes = { day: Time.addDays(ev.day, 1) };
      if (!changes) return;
      e.preventDefault();
      const result = service.updateEvent(ev.id, changes, { source: "drag", mode, label: mode === "move" ? "Moved" : "Resized" });
      onDone(result, mode, { keyboard: true });
    }

    // Enter or Space on an event (a keyboard "click"), or a click on an empty part of a day.
    function onClick(e) {
      const block = e.target.closest(".cl-event");
      if (block) { if (e.detail === 0) onOpen(block.dataset.id); return; }
      const col = e.target.classList && e.target.classList.contains("cl-col") ? e.target : null;
      if (!col) return;
      const r = col.getBoundingClientRect();
      const minute = Math.max(0, Math.min(1380, Math.floor((e.clientY - r.top) / 15) * 15));
      onEmpty(col.dataset.day, minute, col, e.clientY - r.top);
    }

    main.addEventListener("pointerdown", onPointerDown);
    main.addEventListener("pointermove", onPointerMove);
    main.addEventListener("pointerup", onPointerUp);
    main.addEventListener("pointercancel", onPointerCancel);
    main.addEventListener("keydown", onKeyDown);
    main.addEventListener("click", onClick);
  }

  window.Drag = { attach };
})();
