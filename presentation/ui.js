// Owner: Yashita (presentation layer)
// Small DOM helpers, icons, toasts and screen-reader announcements shared by every screen.
(function () {
  "use strict";

  // el("button", { class: "cl-btn", onclick }, "Save")
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(node.style, v);
      else if (k === "dataset") Object.assign(node.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "html") node.innerHTML = v;
      else if (v === true) node.setAttribute(k, "");
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const svg = (path, size, width) =>
    '<svg width="' + (size || 18) + '" height="' + (size || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
    (width || 2) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + "</svg>";

  // Megha's category names (store/records.js) and the label shown for each.
  const CATEGORIES = {
    class: "Class",
    meeting: "Meeting",
    appointment: "Appointment",
    assignment: "Assignment",
    "personal task": "Personal task"
  };
  // The colour name the CSS uses for a category ("personal task" is "personal" in tokens.css).
  const catCss = (category) => (category === "personal task" ? "personal" : category);

  const ICONS = {
    plus: svg('<path d="M12 5v14M5 12h14"/>', 18, 2.2),
    left: svg('<path d="M15 6l-6 6 6 6"/>'),
    right: svg('<path d="M9 6l6 6-6 6"/>'),
    close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', 16),
    menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    warn: svg('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17v.5"/>', 14),
    check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 18, 2.4)
  };

  const icon = (name) => {
    const span = document.createElement("span");
    span.innerHTML = ICONS[name];
    return span.firstChild;
  };

  // Polite announcement for screen readers (status changes, not errors).
  function announce(text) {
    const region = document.getElementById("announce");
    if (!region) return;
    region.textContent = "";
    setTimeout(() => { region.textContent = text; }, 30);
  }

  // One toast at a time. 5 s, or 8 s when it has an action; pauses while hovered or focused.
  let toastTimer = null;
  function toast(text, actions) {
    const region = document.getElementById("toasts");
    region.replaceChildren();
    clearTimeout(toastTimer);
    const t = el("div", { class: "cl-toast", role: "status" }, icon("check"), el("span", { class: "cl-toast__text" }, text));
    for (const a of actions || []) {
      t.append(el("button", { class: "cl-toast__action", onclick: () => { region.replaceChildren(); a.run(); } }, a.label));
    }
    region.append(t);
    const ms = actions && actions.length ? 8000 : 5000;
    const arm = () => { toastTimer = setTimeout(() => t.remove(), ms); };
    t.addEventListener("mouseenter", () => clearTimeout(toastTimer));
    t.addEventListener("mouseleave", arm);
    t.addEventListener("focusin", () => clearTimeout(toastTimer));
    t.addEventListener("focusout", arm);
    arm();
  }

  function download(filename, text) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "application/json" })), download: filename });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // Is the keyboard focus in a text field? Shortcuts are ignored there.
  const typing = (e) => {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
  };

  const UI = { el, icon, ICONS, CATEGORIES, catCss, announce, toast, download, typing };
  window.UI = UI;
})();
