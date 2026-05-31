"use strict";

// ─── Constants ─────────────────────────────────────────────────────────────────

const KIND_LABELS = {
  pdf: "PDF", image: "Imagen", song: "Canción", audio: "Audio",
  video: "Vídeo", presentation: "Presentación", activity: "Ficha",
};

const ISLAND_LABELS = {
  tenerife: "Tenerife", "gran-canaria": "Gran Canaria", lanzarote: "Lanzarote",
  fuerteventura: "Fuerteventura", "la-palma": "La Palma",
  "la-gomera": "La Gomera", "el-hierro": "El Hierro",
};

const LEVEL_LABELS   = { infantil: "Infantil", primaria: "Primaria", eso: "ESO", bachillerato: "Bachillerato", fp: "FP" };
const TOPIC_LABELS   = { naturaleza: "Naturaleza", historia: "Historia", cultura: "Cultura", lengua: "Lengua", matematicas: "Matemáticas", arte: "Arte", ciencias: "Ciencias" };

const FILTER_GROUPS  = [
  { key: "kind",    label: "Tipo",    multi: false, options: KIND_LABELS   },
  { key: "islands", label: "Isla",    multi: true,  options: ISLAND_LABELS },
  { key: "levels",  label: "Nivel",   multi: true,  options: LEVEL_LABELS  },
  { key: "topics",  label: "Materia", multi: true,  options: TOPIC_LABELS  },
];

// ─── HTML escaping ─────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── T14-A: Resource card HTML (with OG enrichment) ──────────────────────────

function resourceCardHtml(r) {
  const hasOg = r.isExternal && r.og && !r.og.failed;

  // Image: prefer OG image for external resources
  let imgSrc = "";
  if (hasOg && r.og.image) {
    imgSrc = r.og.image;
  } else if (r.imageUrl) {
    imgSrc = r.imageUrl;
  }

  // Domain / source hint for external resources
  const domain = hasOg
    ? r.og.domain
    : r.isExternal && r.sourceUrl
    ? (() => { try { return new URL(r.sourceUrl).hostname; } catch { return ""; } })()
    : "";

  // Favicon for external resources
  const favicon = hasOg && r.og.favicon
    ? `<img src="${esc(r.og.favicon)}" alt="" class="resource-card__favicon" loading="lazy" width="14" height="14">`
    : "";

  // Title: prefer OG title for external (already sanitized on server)
  const title = hasOg ? r.og.title || r.title : r.title;

  // Description
  const desc = hasOg && r.og.description ? r.og.description : r.description;

  // Islands
  const islandText = (r.islands || []).includes("todas")
    ? "Todas las islas"
    : (r.islands || []).slice(0, 2)
        .map((s) => ISLAND_LABELS[s] || s)
        .join(", ");

  // Link
  const href   = r.isExternal ? (r.sourceUrl || "#") : `/recursos/${esc(r.slug)}`;
  const target = r.isExternal ? ' target="_blank" rel="noopener noreferrer"' : "";

  // Fallback image for external with failed OG
  const imgHtml = imgSrc
    ? `<div class="resource-card__img"><img src="${esc(imgSrc)}" alt="" loading="lazy"></div>`
    : `<div class="resource-card__img resource-card__img--empty" aria-hidden="true">📄</div>`;

  return `<article class="resource-card">
  ${imgHtml}
  <div class="resource-card__body">
    <div class="resource-card__badges">
      <span class="badge badge--kind">${esc(KIND_LABELS[r.kind] || r.kind)}</span>
      ${islandText ? `<span class="badge badge--island">${esc(islandText)}</span>` : ""}
    </div>
    <h3 class="resource-card__title">${esc(title)}</h3>
    ${desc ? `<p class="resource-card__desc">${esc(desc)}</p>` : ""}
    ${domain ? `<p class="resource-card__source">${favicon}<span>${esc(domain)}</span></p>` : ""}
    <a class="resource-card__link" href="${esc(href)}"${target}>Ver recurso</a>
  </div>
</article>`;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _cursor     = null;
let _loading    = false;
let _fm         = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const gridEl     = document.getElementById("recursos-grid");
const countEl    = document.getElementById("recursos-count");
const loadMoreBtn = document.getElementById("load-more-btn");
const qInput     = document.getElementById("recursos-q");

// ─── Fetch resources ──────────────────────────────────────────────────────────

async function fetchPage(state, cursor = null, append = false) {
  if (_loading) return;
  _loading = true;
  if (loadMoreBtn) loadMoreBtn.disabled = true;

  try {
    const p = new URLSearchParams();
    if (state.q)       p.set("q",  state.q);
    if (state.kind)    p.set("kind", state.kind);
    if (cursor)        p.set("cursor", cursor);
    p.set("limit", "24");

    // Multi-value params
    const islands = Array.isArray(state.islands) ? state.islands : state.islands ? [state.islands] : [];
    const levels  = Array.isArray(state.levels)  ? state.levels  : state.levels  ? [state.levels]  : [];
    const topics  = Array.isArray(state.topics)  ? state.topics  : state.topics  ? [state.topics]  : [];
    islands.forEach((v) => p.append("islands", v));
    levels.forEach((v)  => p.append("levels",  v));
    topics.forEach((v)  => p.append("topics",  v));

    const r    = await fetch(`/api/resources/filtered?${p}`);
    const data = r.ok ? await r.json() : { items: [], nextCursor: null, total: 0 };
    const items = data.items || [];

    if (!append) {
      gridEl.innerHTML = "";
    }

    if (items.length === 0 && !append) {
      gridEl.innerHTML = '<p class="home-empty" style="grid-column:1/-1">No se encontraron recursos con los filtros aplicados.</p>';
    } else {
      gridEl.insertAdjacentHTML("beforeend", items.map(resourceCardHtml).join(""));
    }

    _cursor = data.nextCursor || null;

    if (countEl) {
      const total = data.total ?? 0;
      countEl.textContent = total > 0 ? `${total} resultado${total !== 1 ? "s" : ""}` : "";
    }

    if (loadMoreBtn) {
      loadMoreBtn.hidden    = !_cursor;
      loadMoreBtn.disabled  = false;
    }
  } catch {
    if (!append) {
      gridEl.innerHTML = '<p class="home-empty" style="grid-column:1/-1">No se pudieron cargar los recursos.</p>';
    }
  }

  gridEl.removeAttribute("aria-busy");
  _loading = false;
}

// ─── Filter change handler ─────────────────────────────────────────────────────

function onFilterChange(state) {
  _cursor = null;
  gridEl.setAttribute("aria-busy", "true");
  fetchPage(state, null, false);
  syncCheckboxes(state);
}

// ─── Sync checkboxes ─────────────────────────────────────────────────────────

function syncCheckboxes(state) {
  // Kind radios
  document.querySelectorAll("#filter-kind input[type='radio']").forEach((el) => {
    el.checked = (el.value === (state.kind || ""));
  });

  // Multi checkboxes (islands, levels, topics)
  for (const key of ["islands", "levels", "topics"]) {
    const active = new Set(Array.isArray(state[key]) ? state[key] : state[key] ? [state[key]] : []);
    document.querySelectorAll(`input[data-key="${key}"]`).forEach((el) => {
      el.checked = active.has(el.value);
    });
  }
}

// ─── Wire up sidebar inputs ───────────────────────────────────────────────────

function bindSidebar() {
  // Kind radios
  document.querySelectorAll("#filter-kind input[type='radio']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.checked) _fm?.set("kind", radio.value);
    });
  });

  // Multi checkboxes
  document.querySelectorAll("input[data-key]").forEach((cb) => {
    cb.addEventListener("change", () => {
      _fm?.toggle(cb.dataset.key, cb.value);
    });
  });

  // Text search — debounced
  if (qInput) {
    let debounceTimer;
    qInput.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const q = qInput.value.trim();
        _fm?.set("q", q);
      }, 400);
    });
  }
}

// ─── Load more ────────────────────────────────────────────────────────────────

loadMoreBtn?.addEventListener("click", () => {
  if (_cursor && _fm) fetchPage(_fm.getState(), _cursor, true);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(function init() {
  if (!gridEl) return;

  _fm = window.createFilters?.({
    pillsEl:  document.getElementById("active-filters"),
    groups:   FILTER_GROUPS,
    onChange: onFilterChange,
  });

  if (!_fm) return;

  // Pre-fill q input from URL
  const initialQ = _fm.getSingle("q");
  if (qInput && initialQ) qInput.value = initialQ;

  _fm.initFromUrl(); // triggers onFilterChange → initial fetch
})();
