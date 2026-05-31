"use strict";

// ─── Active nav link ─────────────────────────────────────────────────────────
(function markActive() {
  const path = location.pathname.replace(/\/$/, "") || "/";
  document.querySelectorAll(
    ".main-nav > a, .nav-group__menu a"
  ).forEach((a) => {
    const href = (a.getAttribute("href") || "").replace(/\/$/, "") || "/";
    if (href === path) {
      a.classList.add("active");
      a.setAttribute("aria-current", "page");
    }
  });
})();

// ─── Submenu accordion (aria-expanded + mobile toggle) ───────────────────────
document.querySelectorAll(".nav-group").forEach((group) => {
  const btn  = group.querySelector(".nav-group__btn");
  const menu = group.querySelector(".nav-group__menu");
  if (!btn || !menu) return;

  function open() {
    group.classList.add("is-open");
    btn.setAttribute("aria-expanded", "true");
  }
  function close() {
    group.classList.remove("is-open");
    btn.setAttribute("aria-expanded", "false");
  }

  btn.addEventListener("click", () => {
    if (group.classList.contains("is-open")) close(); else open();
  });

  // Close when focus leaves the group entirely
  group.addEventListener("focusout", (e) => {
    if (!group.contains(e.relatedTarget)) close();
  });

  // Arrow-key navigation inside menu
  menu.addEventListener("keydown", (e) => {
    const items = [...menu.querySelectorAll("a[role='menuitem']")];
    const idx   = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    if (e.key === "ArrowUp")   { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
    if (e.key === "Tab" && !e.shiftKey && idx === items.length - 1) close();
  });
});

// ─── Search overlay ───────────────────────────────────────────────────────────
const overlay     = document.getElementById("search-overlay");
const overlayInput = document.getElementById("search-overlay-input");
const searchToggle = document.querySelector(".search-toggle");

function openSearch() {
  if (!overlay) return;
  overlay.removeAttribute("hidden");
  overlayInput?.focus();
  searchToggle?.setAttribute("aria-expanded", "true");
  document.body.classList.add("overlay-open");
}

function closeSearch() {
  if (!overlay) return;
  overlay.setAttribute("hidden", "");
  searchToggle?.setAttribute("aria-expanded", "false");
  searchToggle?.focus();
  document.body.classList.remove("overlay-open");
}

searchToggle?.addEventListener("click", openSearch);
overlay?.addEventListener("click", (e) => { if (e.target === overlay) closeSearch(); });
document.querySelector(".search-overlay__close")?.addEventListener("click", closeSearch);

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  // Ctrl+K / Cmd+K → open search
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    openSearch();
    return;
  }

  if (e.key === "Escape") {
    // Close open submenus
    document.querySelectorAll(".nav-group.is-open").forEach((g) => {
      g.classList.remove("is-open");
      g.querySelector(".nav-group__btn")?.setAttribute("aria-expanded", "false");
    });
    // Close search overlay
    if (overlay && !overlay.hasAttribute("hidden")) closeSearch();
  }
});

// ─── Subscribe form (best-effort, API exists after T11) ──────────────────────
document.getElementById("subscribe-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form     = e.currentTarget;
  const msgEl    = document.getElementById("subscribe-msg");
  const emailVal = form.email.value.trim();
  if (!emailVal) return;

  try {
    const r = await fetch("/api/subscribers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailVal }),
    });
    const data = await r.json().catch(() => ({}));
    if (msgEl) {
      msgEl.textContent = r.ok
        ? (data.status === "already" ? "Ya estás suscrito/a." : "¡Suscripción confirmada!")
        : (data.error || "No se pudo completar la suscripción.");
      msgEl.removeAttribute("hidden");
    }
    if (r.ok) form.reset();
  } catch {
    if (msgEl) { msgEl.textContent = "Error de red. Inténtalo de nuevo."; msgEl.removeAttribute("hidden"); }
  }
});

// ─── Skip-link target ──────────────────────────────────────────────────────────
(function setupSkipTarget() {
  const main = document.querySelector("main");
  if (main && !main.id) {
    main.id = "main-content";
    main.tabIndex = -1;
  }
})();

// ─── Tracking beacon ──────────────────────────────────────────────────────────
(function beacon() {
  const body = JSON.stringify({ path: location.pathname });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch { /* ignore */ }
})();
