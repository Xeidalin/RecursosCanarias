"use strict";

// Admin CRUD blog: tabla + dialog con editor markdown y preview SSR.
// Depende de window.apiAdminFetch (admin.js).

const CATEGORY_LABELS = {
  "articulo":           "Artículo",
  "recurso-destacado":  "Recurso destacado",
  "novedad":            "Novedad",
  "noticia-consejeria": "Noticia Consejería",
};

const els = {
  search:         document.getElementById("search"),
  categoryFilter: document.getElementById("category-filter"),
  btnNew:         document.getElementById("btn-new"),
  btnMore:        document.getElementById("btn-more"),
  rows:           document.getElementById("rows"),
  count:          document.getElementById("results-count"),
  listError:      document.getElementById("list-error"),
  dialog:         document.getElementById("dialog"),
  form:           document.getElementById("form"),
  formError:      document.getElementById("form-error"),
  dialogTitle:    document.getElementById("dialog-title"),
  btnCancel:      document.getElementById("btn-cancel"),
  preview:        document.getElementById("preview"),
  readingMinutes: document.getElementById("reading-minutes"),
  coverCurrent:   document.getElementById("cover-current"),
  fId:            document.getElementById("f-id"),
  fTitle:         document.getElementById("f-title"),
  fSlug:          document.getElementById("f-slug"),
  fCategory:      document.getElementById("f-category"),
  fPublishedAt:   document.getElementById("f-publishedAt"),
  fExcerpt:       document.getElementById("f-excerpt"),
  fIslands:       document.getElementById("f-islands"),
  fExternalUrl:   document.getElementById("f-externalUrl"),
  fCover:         document.getElementById("f-cover"),
  fFeatured:      document.getElementById("f-featured"),
  fBody:          document.getElementById("f-body"),
  consejeriaBlock: document.querySelector("[data-only-consejeria]"),
};

let state = { q: "", category: "", cursor: null, items: [] };
let searchTimer  = null;
let previewTimer = null;
let currentCoverUrl = "";

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitList(v) {
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function slugify(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

function setHidden(el, hidden) {
  if (!el) return;
  if (hidden) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
}

function showError(el, msg) {
  if (!el) return;
  el.textContent = msg || "";
  setHidden(el, !msg);
}

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Convierte ISO string a value de <input type="datetime-local"> (YYYY-MM-DDTHH:mm)
function isoToLocal(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localToIso(local) {
  if (!local) return "";
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

// ─── List ───────────────────────────────────────────────────────────────────

async function loadList({ reset = false } = {}) {
  if (reset) {
    state.cursor = null;
    state.items = [];
    els.rows.innerHTML = `<tr class="admin-table-empty"><td colspan="5">Cargando…</td></tr>`;
  }
  showError(els.listError, "");

  const params = new URLSearchParams();
  if (state.q)        params.set("q", state.q);
  if (state.category) params.set("category", state.category);
  if (state.cursor)   params.set("cursor", state.cursor);
  params.set("limit", "20");

  try {
    const res  = await window.apiAdminFetch(`/api/admin/blog?${params.toString()}`);
    if (res.status === 401) { window.location.href = "/admin/login"; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error al cargar");
    state.items.push(...(data.items || []));
    state.cursor = data.nextCursor || null;
    renderRows();
    setHidden(els.btnMore, !state.cursor);
    if (typeof data.total === "number") {
      els.count.textContent = `${data.total} post${data.total === 1 ? "" : "s"}`;
    } else {
      els.count.textContent = "";
    }
  } catch (e) {
    showError(els.listError, e.message);
  }
}

function renderRows() {
  if (state.items.length === 0) {
    els.rows.innerHTML = `<tr class="admin-table-empty"><td colspan="5">Sin posts para mostrar.</td></tr>`;
    return;
  }
  els.rows.innerHTML = state.items.map(rowHtml).join("");
  els.rows.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", onRowAction);
  });
}

function rowHtml(p) {
  const dateStr = p.publishedAt
    ? new Date(p.publishedAt).toLocaleDateString("es-ES", { year: "numeric", month: "short", day: "numeric" })
    : "—";
  const featured = p.featured
    ? `<span class="admin-badge admin-badge--external">Sí</span>`
    : `<span class="admin-badge admin-badge--own">No</span>`;
  return `
    <tr data-id="${escapeText(p.id)}">
      <td>${escapeText(p.title)}</td>
      <td>${escapeText(CATEGORY_LABELS[p.category] || p.category)}</td>
      <td>${escapeText(dateStr)}</td>
      <td>${featured}</td>
      <td class="admin-table-actions-col">
        <button data-action="edit" class="admin-link-btn" type="button">Editar</button>
        <button data-action="delete" class="admin-link-btn admin-link-btn--danger" type="button">Eliminar</button>
      </td>
    </tr>`;
}

async function onRowAction(e) {
  const action = e.currentTarget.dataset.action;
  const id     = e.currentTarget.closest("tr")?.dataset.id;
  const item   = state.items.find((p) => p.id === id);
  if (!item) return;
  if (action === "edit") openDialog(item);
  if (action === "delete") deleteItem(item);
}

async function deleteItem(item) {
  if (!confirm(`¿Eliminar "${item.title}"? No se puede deshacer.`)) return;
  const res = await window.apiAdminFetch(`/api/admin/blog/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
  });
  if (res.ok) {
    state.items = state.items.filter((p) => p.id !== item.id);
    renderRows();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "No se pudo eliminar.");
  }
}

// ─── Dialog ────────────────────────────────────────────────────────────────

function applyCategoryFlow() {
  const isConsejeria = els.fCategory.value === "noticia-consejeria";
  setHidden(els.consejeriaBlock, !isConsejeria);
  els.fExternalUrl.toggleAttribute("required", isConsejeria);
}

function openDialog(item = null) {
  showError(els.formError, "");
  els.form.reset();
  currentCoverUrl = "";
  els.coverCurrent.textContent = "";
  els.preview.innerHTML = `<p class="admin-preview__placeholder">El preview aparecerá aquí.</p>`;
  els.readingMinutes.textContent = "1 min lectura";

  if (item) {
    els.dialogTitle.textContent = "Editar post";
    els.fId.value          = item.id;
    els.fTitle.value       = item.title || "";
    els.fSlug.value        = item.slug || "";
    els.fCategory.value    = item.category || "articulo";
    els.fPublishedAt.value = isoToLocal(item.publishedAt);
    els.fExcerpt.value     = item.excerpt || "";
    els.fIslands.value     = (item.islands || []).join(", ");
    els.fExternalUrl.value = item.externalUrl || "";
    els.fFeatured.checked  = !!item.featured;
    els.fBody.value        = item.body || "";
    currentCoverUrl        = item.coverImage || "";
    if (currentCoverUrl) {
      els.coverCurrent.textContent = `Portada actual: ${currentCoverUrl}. Subir un archivo la reemplaza.`;
    }
  } else {
    els.dialogTitle.textContent = "Nuevo post";
    els.fId.value = "";
    els.fCategory.value = "articulo";
  }
  applyCategoryFlow();
  els.dialog.showModal();
  triggerPreview();
}

function closeDialog() {
  els.dialog.close();
}

async function uploadCover(file) {
  const urlRes = await window.apiAdminFetch("/api/admin/blog/upload-cover", { method: "POST" });
  if (!urlRes.ok) throw new Error("No se pudo iniciar la subida de portada.");
  const { uploadUrl } = await urlRes.json();
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!upRes.ok) throw new Error("La subida de portada falló.");
  const { storageId } = await upRes.json();
  if (!storageId) throw new Error("Respuesta de subida inválida.");
  return storageId;
}

// ─── Preview en vivo ───────────────────────────────────────────────────────

async function fetchPreview(markdown) {
  try {
    const res = await window.apiAdminFetch("/api/admin/blog/preview-markdown", {
      method: "POST",
      body: JSON.stringify({ markdown }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function triggerPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const md = els.fBody.value;
    const result = await fetchPreview(md);
    if (!result) return;
    // result.html ya viene saneado por server/markdown.js (allowlist).
    els.preview.innerHTML = result.html || `<p class="admin-preview__placeholder">Sin contenido.</p>`;
    els.readingMinutes.textContent = `${result.readingMinutes} min lectura`;
  }, 300);
}

// ─── Submit ────────────────────────────────────────────────────────────────

async function onSubmit(e) {
  e.preventDefault();
  showError(els.formError, "");

  const id      = els.fId.value || null;
  const islands = splitList(els.fIslands.value);

  if (!els.fTitle.value.trim())   return showError(els.formError, "El título es obligatorio.");
  if (!els.fExcerpt.value.trim()) return showError(els.formError, "El resumen es obligatorio.");
  if (!islands.length)            return showError(els.formError, "Indica al menos una isla.");

  const body = {
    title:       els.fTitle.value.trim(),
    slug:        els.fSlug.value.trim() || slugify(els.fTitle.value),
    category:    els.fCategory.value,
    excerpt:     els.fExcerpt.value.trim(),
    body:        els.fBody.value,
    islands,
    featured:    els.fFeatured.checked,
  };
  if (els.fPublishedAt.value)        body.publishedAt = localToIso(els.fPublishedAt.value);
  if (els.fExternalUrl.value.trim()) body.externalUrl = els.fExternalUrl.value.trim();
  if (!els.fCover.files?.[0] && currentCoverUrl) body.coverImage = currentCoverUrl;

  if (els.fCover.files?.[0]) {
    try {
      const storageId = await uploadCover(els.fCover.files[0]);
      body.coverStorageId = storageId;
    } catch (err) {
      return showError(els.formError, err.message);
    }
  }

  const url    = id ? `/api/admin/blog/${encodeURIComponent(id)}` : `/api/admin/blog`;
  const method = id ? "PATCH" : "POST";

  try {
    const res  = await window.apiAdminFetch(url, { method, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error al guardar.");
    closeDialog();
    await loadList({ reset: true });
  } catch (err) {
    showError(els.formError, err.message);
  }
}

// ─── Wire-up ────────────────────────────────────────────────────────────────

els.search?.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = els.search.value.trim();
    loadList({ reset: true });
  }, 250);
});
els.categoryFilter?.addEventListener("change", () => {
  state.category = els.categoryFilter.value;
  loadList({ reset: true });
});
els.btnMore?.addEventListener("click", () => loadList());
els.btnNew?.addEventListener("click", () => openDialog());
els.btnCancel?.addEventListener("click", closeDialog);
els.form?.addEventListener("submit", onSubmit);
els.fCategory?.addEventListener("change", applyCategoryFlow);
els.fTitle?.addEventListener("blur", () => {
  if (!els.fSlug.value.trim() && els.fTitle.value.trim()) {
    els.fSlug.value = slugify(els.fTitle.value);
  }
});
els.fBody?.addEventListener("input", triggerPreview);

loadList({ reset: true });
