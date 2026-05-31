"use strict";

(async function loadDescargas() {
  const grid    = document.getElementById("descargas-grid");
  const loading = document.getElementById("descargas-loading");
  if (!grid) return;

  async function fetchDescargas(params) {
    const qs = new URLSearchParams(params);
    qs.set("hasFile", "1");
    const r = await fetch(`/api/resources/filtered?${qs.toString()}`);
    if (!r.ok) throw new Error("Error al cargar");
    return r.json();
  }

  function buildUrl(params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) qs.set(k, v);
    }
    qs.set("hasFile", "1");
    return `/api/resources/filtered?${qs.toString()}`;
  }

  function renderKind(kind) {
    const m = { pdf: "PDF", image: "Imagen", audio: "Audio", video: "Video", presentation: "Presentación", activity: "Actividad" };
    return m[kind] || kind;
  }

  function renderItems(items) {
    if (!items.length) {
      grid.innerHTML = "<p>No se encontraron recursos descargables con esos filtros.</p>";
      return;
    }
    grid.innerHTML = items.map((r) => {
      const dlBtn = r.fileUrl
        ? `<a class="descargas-card__dl" href="/api/resources/${escapeHtml(r.id)}/download" download>Descargar</a>`
        : "";
      const img = r.imageUrl
        ? `<img src="${escapeHtml(r.imageUrl)}" alt="" loading="lazy" class="descargas-card__img">`
        : "";
      return `<article class="descargas-card">
        ${img}
        <div class="descargas-card__body">
          <span class="badge">${renderKind(r.kind)}</span>
          <h2 class="descargas-card__title">${escapeHtml(r.title)}</h2>
          <p class="descargas-card__desc">${escapeHtml(r.description || "")}</p>
          ${dlBtn}
        </div>
      </article>`;
    }).join("");
  }

  try {
    const data = await fetchDescargas({ limit: "50" });
    loading?.remove();
    renderItems(data.items || []);
  } catch {
    if (loading) loading.textContent = "Error al cargar recursos. Inténtalo de nuevo más tarde.";
  }

  // Filter handlers
  document.getElementById("filter-kind")?.addEventListener("change", applyFilters);
  document.getElementById("filter-island")?.addEventListener("change", applyFilters);

  async function applyFilters() {
    const kind   = document.getElementById("filter-kind")?.value || "";
    const island = document.getElementById("filter-island")?.value || "";
    const params = { limit: "50" };
    if (kind)   params.kind    = kind;
    if (island) params.islands = island;
    try {
      grid.innerHTML = "";
      if (loading) { loading.removeAttribute("hidden"); loading.textContent = "Cargando..."; }
      const data = await fetchDescargas(params);
      loading?.setAttribute("hidden", "");
      renderItems(data.items || []);
    } catch {
      if (loading) loading.textContent = "Error al cargar. Inténtalo de nuevo.";
    }
  }
})();

function escapeHtml(str) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}
