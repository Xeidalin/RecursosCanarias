"use strict";

// Admin mensajes de contacto: bandeja paginada + marcar atendido.
// Depende de window.apiAdminFetch (admin.js).

const TYPE_LABELS = {
  colaboracion: "Colaboración",
  sugerencia:   "Sugerencia",
  error:        "Error",
  otro:         "Otro",
};

const els = {
  rows:      document.getElementById("rows"),
  count:     document.getElementById("results-count"),
  listError: document.getElementById("list-error"),
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
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Load ───────────────────────────────────────────────────────────────────

async function load(cursor = null) {
  showError("");

  try {
    const params = new URLSearchParams();
    params.set("limit", "50");
    if (cursor) params.set("cursor", cursor);

    const r    = await window.apiAdminFetch(`/api/admin/messages?${params}`);
    const data = await r.json();

    if (!r.ok) {
      showError(data.error || "Error al cargar mensajes.");
      return;
    }

    if (!cursor) state.items = [];
    state.items.push(...data.items);
    state.cursor  = data.nextCursor;
    state.hasMore = data.hasMore;

    render();
    setHidden(els.btnMore, !state.hasMore);
  } catch {
    showError("Error de red al cargar mensajes.");
  }
}

function render() {
  if (els.count) {
    const total = state.items.length;
    els.count.textContent = `${total} mensaje${total === 1 ? "" : "s"}${state.hasMore ? "+" : ""}`;
  }

  if (!els.rows) return;

  if (!state.items.length) {
    els.rows.innerHTML = '<tr class="admin-table-empty"><td colspan="7">No hay mensajes.</td></tr>';
    return;
  }

  els.rows.innerHTML = state.items.map((m) => {
    const typeLabel = TYPE_LABELS[m.type] || m.type;
    const estadoHtml = m.handled
      ? `<span class="admin-estado admin-estado--activo">Atendido</span>`
      : `<span class="admin-estado admin-estado--inactivo">Pendiente</span>`;

    const btnHtml = m.handled
      ? ""
      : `<button class="admin-secondary-btn admin-action-btn" data-id="${escapeText(m._id)}" data-action="mark-handled" type="button">Marcar atendido</button>`;

    return `<tr>
      <td>${escapeText(m.name)}</td>
      <td>${escapeText(m.email)}</td>
      <td>${escapeText(typeLabel)}</td>
      <td class="admin-message-cell">${escapeText(m.message.slice(0, 120))}${m.message.length > 120 ? "…" : ""}</td>
      <td>${escapeText(formatDate(m.createdAt))}</td>
      <td>${estadoHtml}</td>
      <td>${btnHtml}</td>
    </tr>`;
  }).join("");
}

// ─── Mark handled ───────────────────────────────────────────────────────────

els.rows?.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action='mark-handled']");
  if (!btn) return;
  const id = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = "…";

  try {
    const r = await window.apiAdminFetch(`/api/admin/messages/${encodeURIComponent(id)}/mark-handled`, {
      method: "POST",
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      // Update local state
      const item = state.items.find((m) => m._id === id);
      if (item) item.handled = true;
      render();
    } else {
      btn.disabled = false;
      btn.textContent = "Marcar atendido";
      alert(data.error || "Error al marcar como atendido.");
    }
  } catch {
    btn.disabled = false;
    btn.textContent = "Marcar atendido";
    alert("Error de red.");
  }
});

// ─── Load more ──────────────────────────────────────────────────────────────

els.btnMore?.addEventListener("click", () => load(state.cursor));

// ─── Init ───────────────────────────────────────────────────────────────────

load();
