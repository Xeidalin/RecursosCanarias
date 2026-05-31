"use strict";

// ─── CSRF ─────────────────────────────────────────────────────────────────────

function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)rc_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function apiAdminFetch(url, options = {}) {
  const method  = (options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});

  if (!["GET", "HEAD"].includes(method)) {
    const csrf = getCsrfToken();
    if (csrf) headers.set("X-CSRF-Token", csrf);
    if (options.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  return fetch(url, { ...options, headers, credentials: "same-origin" });
}

// Expone el helper a otros scripts del admin sin tocar globals salvo este uno.
window.apiAdminFetch = apiAdminFetch;

// ─── Active nav item ──────────────────────────────────────────────────────────

(function markAdminActive() {
  const path = location.pathname.replace(/\/+$/, "") || "/admin";
  document.querySelectorAll(".admin-nav__item").forEach((a) => {
    const href = (a.getAttribute("href") || "").replace(/\/+$/, "") || "/admin";
    if (href === path) {
      a.classList.add("active");
      a.setAttribute("aria-current", "page");
    }
  });
})();

// ─── Logout ───────────────────────────────────────────────────────────────────

document.getElementById("admin-logout")?.addEventListener("click", async () => {
  try {
    const res = await apiAdminFetch("/api/admin/logout", { method: "POST" });
    if (res.ok || res.status === 401) window.location.href = "/admin/login";
  } catch {
    window.location.href = "/admin/login";
  }
});

// ─── Login form ───────────────────────────────────────────────────────────────

document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form  = e.currentTarget;
  const errEl = document.getElementById("login-error");
  const btn   = form.querySelector("button[type='submit']");

  if (errEl) { errEl.textContent = ""; errEl.hidden = true; }
  if (btn)   btn.disabled = true;

  try {
    const res  = await fetch("/api/admin/login", {
      method:      "POST",
      headers:     { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username: form.username.value.trim(),
        password: form.password.value,
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      window.location.href = "/admin";
    } else {
      if (errEl) {
        errEl.textContent = data.error || "Credenciales incorrectas.";
        errEl.hidden = false;
      }
    }
  } catch {
    if (errEl) { errEl.textContent = "Error de red. Inténtalo de nuevo."; errEl.hidden = false; }
  } finally {
    if (btn) btn.disabled = false;
  }
});

// ─── Dashboard stats ────────────────────────────────────────────────────────

(async function loadDashboardStats() {
  const resEl = document.getElementById("admin-stats-section");
  if (!resEl) return; // solo en /admin

  try {
    const res  = await apiAdminFetch("/api/admin/stats");
    if (!res.ok) return;
    const stats = await res.json();

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("stat-resources",  stats.resources?.total ?? "—");
    set("stat-posts",      stats.blogPosts?.total ?? "—");
    set("stat-subscribers", stats.subscribers?.active ?? "—");
    set("stat-messages",   stats.contactMessages?.unhandled ?? "—");
    set("stat-views-today",    stats.pageViews?.today ?? "—");
    set("stat-views-yesterday", stats.pageViews?.yesterday ?? "—");
    set("stat-views-7d",   stats.pageViews?.last7d ?? "—");
    set("stat-views-30d",  stats.pageViews?.last30d ?? "—");

    const top5 = stats.pageViews?.top5;
    if (top5 && top5.length) {
      const topDiv = document.getElementById("admin-stats-top");
      const topList = document.getElementById("admin-stats-top-list");
      if (topDiv && topList) {
        topDiv.removeAttribute("hidden");
        topList.innerHTML = top5.map((p) =>
          `<li><span>${escapeHtml(p.path)}</span> <span>${p.count}</span></li>`
        ).join("");
      }
    }
  } catch { /* dashboard stats are best-effort */ }
})();

function escapeHtml(str) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}
