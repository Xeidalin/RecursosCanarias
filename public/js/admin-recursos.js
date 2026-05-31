"use strict";

// Admin CRUD de recursos. Depende de window.apiAdminFetch (admin.js).

const KIND_LABELS = {
  pdf: "PDF", image: "Imagen", song: "Canción", audio: "Audio",
  video: "Vídeo", presentation: "Presentación", activity: "Actividad",
};

const els = {
  search:        document.getElementById("search"),
  kindFilter:    document.getElementById("kind-filter"),
  btnNew:        document.getElementById("btn-new"),
  btnMore:       document.getElementById("btn-more"),
  rows:          document.getElementById("rows"),
  count:         document.getElementById("results-count"),
  listError:     document.getElementById("list-error"),
  dialog:        document.getElementById("dialog"),
  form:          document.getElementById("form"),
  formError:     document.getElementById("form-error"),
  dialogTitle:   document.getElementById("dialog-title"),
  btnCancel:     document.getElementById("btn-cancel"),
  fId:           document.getElementById("f-id"),
  fTitle:        document.getElementById("f-title"),
  fSlug:         document.getElementById("f-slug"),
  fKind:         document.getElementById("f-kind"),
  fSourceUrl:    document.getElementById("f-sourceUrl"),
  fFile:         document.getElementById("f-file"),
  fIslands:      document.getElementById("f-islands"),
  fTopics:       document.getElementById("f-topics"),
  fLevels:       document.getElementById("f-levels"),
  fDescription:  document.getElementById("f-description"),
  fTags:         document.getElementById("f-tags"),
};

let state = {
  q: "", kind: "", cursor: null, items: [],
};
let searchTimer = null;

// ─── Helpers ────────────────────────────────────────────────────────────────

function splitList(value) {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
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

// ─── Modo (externo/propio) ──────────────────────────────────────────────────

function applyMode() {
  const mode = els.form.querySelector("input[name=mode]:checked")?.value || "external";
  const isExternal = mode === "external";
  for (const el of els.form.querySelectorAll("[data-only-external]")) {
    setHidden(el, !isExternal);
    el.querySelector("input,select,textarea")?.toggleAttribute("required", isExternal);
  }
  for (const el of els.form.querySelectorAll("[data-only-own]")) {
    setHidden(el, isExternal);
  }
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
  if (state.q)      params.set("q", state.q);
  if (state.kind)   params.set("kind", state.kind);
  if (state.cursor) params.set("cursor", state.cursor);
  params.set("limit", "20");

  try {
    const res  = await window.apiAdminFetch(`/api/admin/resources?${params.toString()}`);
    if (res.status === 401) { window.location.href = "/admin/login"; return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Error al cargar");
    state.items.push(...(data.items || []));
    state.cursor = data.nextCursor || null;
    renderRows();
    if (typeof data.total === "number") {
      els.count.textContent = `${data.total} resultado${data.total === 1 ? "" : "s"}`;
    }
    setHidden(els.btnMore, !state.cursor);
  } catch (e) {
    showError(els.listError, e.message);
  }
}

function renderRows() {
  if (state.items.length === 0) {
    els.rows.innerHTML = `<tr class="admin-table-empty"><td colspan="5">Sin recursos para mostrar.</td></tr>`;
    return;
  }
  els.rows.innerHTML = state.items.map(rowHtml).join("");
  els.rows.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", onRowAction);
  });
}

function rowHtml(r) {
  const title  = escapeText(r.title);
  const kind   = escapeText(KIND_LABELS[r.kind] || r.kind);
  const origin = r.isExternal
    ? `<span class="admin-badge admin-badge--external">Externo</span>`
    : `<span class="admin-badge admin-badge--own">Propio</span>`;
  const islands = (r.islands || []).map(escapeText).join(", ");
  return `
    <tr data-id="${escapeText(r.id)}">
      <td>${title}</td>
      <td>${kind}</td>
      <td>${origin}</td>
      <td>${islands}</td>
      <td class="admin-table-actions-col">
        <button data-action="edit" class="admin-link-btn" type="button">Editar</button>
        ${r.isExternal
          ? `<button data-action="refresh-og" class="admin-link-btn" type="button">Refrescar OG</button>`
          : ""}
        <button data-action="delete" class="admin-link-btn admin-link-btn--danger" type="button">Eliminar</button>
      </td>
    </tr>`;
}

function escapeText(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ─── Acciones ───────────────────────────────────────────────────────────────

async function onRowAction(e) {
  const action = e.currentTarget.dataset.action;
  const tr     = e.currentTarget.closest("tr");
  const id     = tr?.dataset.id;
  const item   = state.items.find((r) => r.id === id);
  if (!item) return;

  if (action === "edit") openDialog(item);
  if (action === "delete") deleteItem(item);
  if (action === "refresh-og") refreshOg(item);
}

async function deleteItem(item) {
  if (!confirm(`¿Eliminar "${item.title}"? No se puede deshacer.`)) return;
  const res = await window.apiAdminFetch(`/api/admin/resources/${encodeURIComponent(item.id)}`, {
    method: "DELETE",
  });
  if (res.ok) {
    state.items = state.items.filter((r) => r.id !== item.id);
    renderRows();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "No se pudo eliminar.");
  }
}

async function refreshOg(item) {
  const res = await window.apiAdminFetch(
    `/api/admin/resources/${encodeURIComponent(item.id)}/refresh-og`,
    { method: "POST" }
  );
  if (res.status === 202) {
    alert("Refresco encolado. Recarga en unos segundos para ver el resultado.");
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || "No se pudo encolar el refresco.");
  }
}

// ─── Dialog crear/editar ────────────────────────────────────────────────────

function openDialog(item = null) {
  showError(els.formError, "");
  els.form.reset();
  if (item) {
    els.dialogTitle.textContent = "Editar recurso";
    els.fId.value          = item.id;
    els.fTitle.value       = item.title || "";
    els.fSlug.value        = item.slug || "";
    els.fKind.value        = item.kind || "pdf";
    els.fSourceUrl.value   = item.sourceUrl || "";
    els.fIslands.value     = (item.islands || []).join(", ");
    els.fTopics.value      = (item.topics || []).join(", ");
    els.fLevels.value      = (item.levels || []).join(", ");
    els.fDescription.value = item.description || "";
    els.fTags.value        = (item.tags || []).join(", ");
    const mode = item.isExternal ? "external" : "own";
    els.form.querySelector(`input[name=mode][value=${mode}]`).checked = true;
  } else {
    els.dialogTitle.textContent = "Nuevo recurso";
    els.fId.value = "";
    els.form.querySelector("input[name=mode][value=external]").checked = true;
  }
  applyMode();
  els.dialog.showModal();
}

function closeDialog() {
  els.dialog.close();
}

async function uploadFile(file) {
  // 1. Pedir upload URL al server
  const urlRes = await window.apiAdminFetch("/api/admin/resources/upload-url", { method: "POST" });
  if (!urlRes.ok) throw new Error("No se pudo iniciar la subida.");
  const { uploadUrl } = await urlRes.json();
  // 2. Subir el archivo a la URL de Convex storage
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!upRes.ok) throw new Error("La subida falló.");
  const { storageId } = await upRes.json();
  if (!storageId) throw new Error("Respuesta de subida inválida.");
  return storageId;
}

async function onSubmit(e) {
  e.preventDefault();
  showError(els.formError, "");

  const mode       = els.form.querySelector("input[name=mode]:checked")?.value || "external";
  const isExternal = mode === "external";
  const id         = els.fId.value || null;

  const islands = splitList(els.fIslands.value);
  const topics  = splitList(els.fTopics.value);
  const levels  = splitList(els.fLevels.value);
  const tags    = splitList(els.fTags.value);

  if (!els.fTitle.value.trim()) return showError(els.formError, "El título es obligatorio.");
  if (!islands.length) return showError(els.formError, "Indica al menos una isla.");
  if (!topics.length)  return showError(els.formError, "Indica al menos un tema.");
  if (!levels.length)  return showError(els.formError, "Indica al menos un nivel.");
  if (isExternal && !els.fSourceUrl.value.trim())
    return showError(els.formError, "URL de origen obligatoria en modo externo.");

  const body = {
    slug:        els.fSlug.value.trim() || slugify(els.fTitle.value),
    title:       els.fTitle.value.trim(),
    kind:        els.fKind.value,
    isExternal,
    sourceUrl:   isExternal ? els.fSourceUrl.value.trim() : "",
    islands, topics, levels, tags,
    description: els.fDescription.value.trim(),
  };

  // En modo propio, subir archivo si hay
  if (!isExternal && els.fFile.files?.[0]) {
    try {
      const storageId = await uploadFile(els.fFile.files[0]);
      body.fileStorageId = storageId;
    } catch (err) {
      return showError(els.formError, err.message);
    }
  }

  const url = id
    ? `/api/admin/resources/${encodeURIComponent(id)}`
    : `/api/admin/resources`;
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
els.kindFilter?.addEventListener("change", () => {
  state.kind = els.kindFilter.value;
  loadList({ reset: true });
});
els.btnMore?.addEventListener("click", () => loadList());
els.btnNew?.addEventListener("click", () => openDialog());
els.btnCancel?.addEventListener("click", closeDialog);
els.form?.addEventListener("submit", onSubmit);
els.form?.querySelectorAll("input[name=mode]").forEach((r) => {
  r.addEventListener("change", applyMode);
});
els.fTitle?.addEventListener("blur", () => {
  if (!els.fSlug.value.trim() && els.fTitle.value.trim()) {
    els.fSlug.value = slugify(els.fTitle.value);
  }
});

loadList({ reset: true });
