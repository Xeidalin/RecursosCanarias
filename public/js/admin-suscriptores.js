"use strict";

// Admin suscriptores: tabla paginada + export CSV.
// Depende de window.apiAdminFetch (admin.js).

const els = {
  rows:      document.getElementById("rows"),
  count:     document.getElementById("results-count"),
  listError: document.getElementById("list-error"),
  btnCsv:    document.getElementById("btn-csv"),
  btnMore:   document.getElementById("btn-more"),
};

let state = { cursor: null, hasMore: false, items: [] };

// ─── Helpers ────────────────────────────────────────────────────────────────

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}

function showError(msg) {
  if (!els.listError) return;
  els.listError.textContent = msg || "";
  setHidden(els.listError, !msg);
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-ES", {
    year: "numeric", month: "short", day: "numeric",
  });
}

// ─── Load ───────────────────────────────────────────────────────────────────

async function load(cursor = null) {
  showError("");

  try {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (cursor) params.set("cursor", cursor);

    const r    = await window.apiAdminFetch(`/api/admin/subscribers?${params}`);
    const data = await r.json();

    if (!r.ok) {
      showError(data.error || "Error al cargar suscriptores.");
      return;
    }

    if (!cursor) state.items = [];
    state.items.push(...data.items);
    state.cursor  = data.nextCursor;
    state.hasMore = data.hasMore;

    render();
    setHidden(els.btnMore, !state.hasMore);
  } catch {
    showError("Error de red al cargar suscriptores.");
  }
}

function render() {
  if (els.count) {
    const total = state.items.length;
    els.count.textContent = `${total} suscriptor${total === 1 ? "" : "es"}${state.hasMore ? "+" : ""}`;
  }

  if (!els.rows) return;

  if (!state.items.length) {
    els.rows.innerHTML = '<tr class="admin-table-empty"><td colspan="3">No hay suscriptores.</td></tr>';
    return;
  }

  els.rows.innerHTML = state.items.map((s) => {
    const estado = s.unsubscribedAt ? "Dado de baja" : "Activo";
    const estadoLabel = s.unsubscribedAt
      ? `<span class="admin-estado admin-estado--inactivo">${escapeText(estado)} (${formatDate(s.unsubscribedAt)})</span>`
      : `<span class="admin-estado admin-estado--activo">${escapeText(estado)}</span>`;

    return `<tr>
      <td>${escapeText(s.email)}</td>
      <td>${escapeText(formatDate(s.createdAt))}</td>
      <td>${estadoLabel}</td>
    </tr>`;
  }).join("");
}

// ─── CSV export ─────────────────────────────────────────────────────────────

els.btnCsv?.addEventListener("click", () => {
  window.location.href = "/api/admin/subscribers/csv";
});

// ─── Load more ──────────────────────────────────────────────────────────────

els.btnMore?.addEventListener("click", () => load(state.cursor));

// ─── Init ───────────────────────────────────────────────────────────────────

load();
