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
