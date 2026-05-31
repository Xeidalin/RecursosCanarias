"use strict";

// ── Search page (/buscar) ──────────────────────────────────────────────────
(function initSearchPage() {
  const form    = document.querySelector(".search-form");
  const input   = document.querySelector(".search-input");
  const results = document.getElementById("search-results");
  if (!form || !results) return;

  // Si ya hay query en URL, ejecutar búsqueda al cargar
  const urlParams = new URLSearchParams(location.search);
  const initialQ  = urlParams.get("q")?.trim();
  if (initialQ) {
    if (input) input.value = initialQ;
    doSearch(initialQ, results);
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input?.value.trim();
    if (!q) return;
    // Actualizar URL sin recargar
    const url = new URL(location);
    url.searchParams.set("q", q);
    history.replaceState(null, "", url);
    doSearch(q, results);
  });
})();

// ── Search overlay (Ctrl+K) ─────────────────────────────────────────────────
(function initSearchOverlay() {
  const overlay = document.getElementById("search-overlay");
  const input   = document.getElementById("search-overlay-input");
  const results = document.getElementById("search-overlay-results");
  if (!overlay || !input || !results) return;

  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = "";
      return;
    }
    debounceTimer = setTimeout(() => doSearch(q, results), 250);
  });

  // Navegar con Enter
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const q = input.value.trim();
      if (q) {
        overlay.setAttribute("hidden", "");
        document.body.classList.remove("overlay-open");
        location.href = `/buscar?q=${encodeURIComponent(q)}`;
      }
    }
  });
})();

// ── Shared search logic ─────────────────────────────────────────────────────
async function doSearch(q, container) {
  container.innerHTML = "<p class='search-loading'>Buscando...</p>";
  try {
    const r  = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`);
    const data = await r.json();
    if (!Array.isArray(data.results) || data.results.length === 0) {
      container.innerHTML = "<p class='search-empty'>No se encontraron resultados.</p>";
      return;
    }
    renderResults(data.results, container);
  } catch {
    container.innerHTML = "<p class='search-error'>Error al buscar. Intenta de nuevo.</p>";
  }
}

function renderResults(items, container) {
  const CAT_LABELS = {
    articulo: "Artículo", "recurso-destacado": "Recurso destacado",
    novedad: "Novedad", "noticia-consejeria": "Consejería",
  };
  const KIND_LABELS = {
    pdf: "PDF", image: "Imagen", song: "Canción", audio: "Audio",
    video: "Video", presentation: "Presentación", activity: "Actividad",
  };

  container.innerHTML = items.map((item) => {
    const isResource = item.type === "resource";
    const url        = isResource ? `/recursos?q=${encodeURI(item.slug)}` : `/blog/${encodeURI(item.slug)}`;
    const badge      = isResource
      ? `<span class="badge">${KIND_LABELS[item.kind] || item.kind}</span>`
      : `<span class="badge badge--category">${CAT_LABELS[item.category] || item.category}</span>`;
    const typeLabel  = isResource ? "Recurso" : "Blog";
    const img        = item.imageUrl
      ? `<img src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" class="search-result__img">`
      : "";

    return `<article class="search-result">
      ${img}
      <div class="search-result__body">
        <div class="search-result__meta">${badge} <span class="search-result__type">${typeLabel}</span></div>
        <h2 class="search-result__title"><a href="${url}">${escapeHtml(item.title)}</a></h2>
        <p class="search-result__desc">${escapeHtml(item.description || "")}</p>
      </div>
    </article>`;
  }).join("");
}

function escapeHtml(str) {
  const m = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(str).replace(/[&<>"']/g, (c) => m[c]);
}
